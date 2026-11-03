#!/usr/bin/env python3
"""Bounded provider-only Cloudflare Planner compatibility QA.

Uses the current PHP Planner prompt/tool registry and production Cloudflare credential.
Six synthetic PTSCPS questions are sent with the same OpenAI-compatible request shape
and one strict retry only when the first plan is invalid. No raw prompts, provider
responses, credentials, source facts, or user data are persisted.
"""
from __future__ import annotations
import ftplib, io, json, os, re, ssl, subprocess
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen

MODEL='@cf/meta/llama-3.3-70b-instruct-fp8-fast'
CASES=(
 ('vi_services_second','Trong danh sách lĩnh vực dịch vụ trên trang chủ PTSC, mục đứng thứ hai là gì? Chỉ nêu tên của mục đó.'),
 ('en_services_second','Which service area is listed second in the PTSC homepage section? Give only its exact name.'),
 ('vi_clients_last','Trong danh sách khách hàng tiêu biểu trên trang chủ PTSC, mục đứng cuối cùng là gì? Chỉ nêu tên của mục đó.'),
 ('en_clients_last','Which featured customer is listed last in the PTSC homepage section? Give only its exact name.'),
 ('vi_projects_paraphrase','Những công trình khẳng định năng lực PPS là gì?'),
 ('en_projects_paraphrase',"Which projects demonstrate PPS's capabilities?"),
)
SAFE_REASONS={'invalid_json','direct_response','plan_shape','requires_synthesis_type','step_shape','unknown_skill','unknown_action','unknown_param','invalid_param_type','param_conflict','transport_error','empty_response'}

def env_value(name):
 p=re.compile(r'^\s*(?:export\s+)?'+re.escape(name)+r'\s*=\s*(.*)\s*$'); vals=[]
 for line in os.environ.get('ENV_FILE','').splitlines():
  m=p.match(line)
  if m:
   v=m.group(1).strip();
   if len(v)>=2 and v[0]==v[-1] and v[0] in "'\"": v=v[1:-1]
   vals.append(v)
 return vals[0] if len(vals)==1 else ''

def config():
 raw=os.environ.get('FTP_SERVER','').strip(); raw=raw if '://' in raw else 'ftp://'+raw
 fu=urlsplit(raw); wu=urlsplit(env_value('WC_URL'))
 if not fu.hostname or fu.scheme not in ('ftp','ftps') or fu.port not in (None,21) or fu.username or fu.password or fu.path.strip('/') or wu.scheme!='https' or not wu.hostname or wu.port not in (None,443) or wu.path not in ('','/') or wu.query or wu.fragment: raise RuntimeError('unsafe config')
 root=f'/domains/{wu.hostname}/public_html'; ftp=ftplib.FTP_TLS(context=ssl.create_default_context(),timeout=25)
 try:
  ftp.connect(fu.hostname,fu.port or 21); ftp.auth(); ftp.login(os.environ['FTP_USERNAME'],os.environ['FTP_PASSWORD']); ftp.prot_p(); ftp.cwd(root)
  if ftp.pwd().rstrip('/')!=root.rstrip('/'): raise RuntimeError('root mismatch')
  b=io.BytesIO(); ftp.retrbinary('RETR wp-config.php',b.write)
 finally:
  try: ftp.quit()
  except Exception: pass
 text=b.getvalue().decode('utf-8',errors='replace')
 def const(name):
  m=re.search(r"define\s*\(\s*['\"]"+re.escape(name)+r"['\"]\s*,\s*(['\"])(.*?)\1\s*\)",text,re.S)
  return m.group(2).strip() if m else ''
 key,account=const('CLOUDFLARE_API_KEY'),const('CLOUDFLARE_ACCOUNT_ID')
 if not key or not account: raise RuntimeError('Cloudflare credential unavailable')
 return key,account

def call(url,key,system,user):
 payload={'model':MODEL,'messages':[{'role':'system','content':system},{'role':'user','content':user}],'temperature':0.1,'max_tokens':800,'response_format':{'type':'json_object'}}
 req=Request(url,data=json.dumps(payload,separators=(',',':'),ensure_ascii=False).encode(),headers={'Content-Type':'application/json','Authorization':'Bearer '+key,'User-Agent':'PTSCPS-cf-planner-probe/1.0'},method='POST')
 try:
  with urlopen(req,timeout=20) as r: code,raw=r.status,r.read(300000)
 except HTTPError as e: code,raw=e.code,e.read(300000)
 except (URLError,TimeoutError): return 0,''
 try:
  obj=json.loads(raw)
  text=obj.get('choices',[{}])[0].get('message',{}).get('content','') if isinstance(obj,dict) else ''
  return code,text if isinstance(text,str) else ''
 except Exception: return code,''

def validate(raw):
 if not raw: return {'valid':False,'reason':'empty_response','skill':'','action':'','requires_synthesis':False,'mode':''}
 p=subprocess.run(['php','scripts/ptscps-agent-cloudflare-planner-helper.php','source-php','validate'],input=raw,text=True,capture_output=True,timeout=15)
 if p.returncode!=0: raise RuntimeError('validator failed')
 obj=json.loads(p.stdout)
 if obj.get('reason') not in SAFE_REASONS and obj.get('reason'): obj['reason']='other'
 return obj

def main():
 prompt=subprocess.run(['php','scripts/ptscps-agent-cloudflare-planner-helper.php','source-php','prompt'],text=True,capture_output=True,timeout=20,check=True).stdout
 key,account=config(); url='https://api.cloudflare.com/client/v4/accounts/'+quote(account,safe='')+'/ai/v1/chat/completions'
 results=[]
 strict='\n\nLẦN TRẢ TRƯỚC BỊ TỪ CHỐI. Hãy lập lại kế hoạch, chỉ dùng skill/action/params được mô tả trong SKILLS ĐƯỢC PHÉP. requires_synthesis là boolean cấp ngoài cùng. Cấu trúc: {"plan":[{"skill":"tên skill","action":"tên action","params":{}}],"requires_synthesis":true}. Chỉ trả JSON.'
 for cid,q in CASES:
  attempts=[]; final=None
  for n in (1,2):
   code,raw=call(url,key,prompt+(strict if n==2 else ''),q); v=validate(raw)
   expected=bool(v.get('valid') and v.get('skill')=='knowledge' and v.get('action')=='search' and v.get('mode')=='collection')
   attempts.append({'attempt':n,'http_status':code,'valid_plan':bool(v.get('valid')),'expected_route':expected,'reason':str(v.get('reason') or '')[:40],'skill':str(v.get('skill') or '')[:32],'action':str(v.get('action') or '')[:32],'mode':str(v.get('mode') or '')[:24]})
   if expected: final=attempts[-1]; break
  results.append({'case':cid,'status':'PASS' if final else 'FAIL','attempts':attempts})
  print('PTSCPS_CF_PLANNER_CASE='+json.dumps({'case':cid,'status':results[-1]['status'],'attempts':len(attempts)},sort_keys=True))
 report={'schema':1,'scope':'cloudflare_current_planner_contract_six_cases','source_php':'a73b33da2f8fbf12d2e59c4d1f5aa8ada42733e1','results':results,'summary':{'total':len(results),'passed':sum(x['status']=='PASS' for x in results),'failed':sum(x['status']=='FAIL' for x in results)},'notes':['Provider-only bounded QA; no Agent chat or CMS/index mutation.','No credentials, raw prompts/questions, provider response text, source facts or sessions persisted.','PASS requires valid current tool contract and knowledge.search mode=collection.']}
 out=Path('audit/ptscps-agent-cloudflare-planner-probe-summary.json'); out.parent.mkdir(parents=True,exist_ok=True); out.write_text(json.dumps(report,indent=2,sort_keys=True)+'\n')
 print('PTSCPS_CF_PLANNER_SUMMARY='+json.dumps(report['summary'],sort_keys=True))
 if report['summary']['passed']<5: raise SystemExit(1)
if __name__=='__main__': main()
