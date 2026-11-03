#!/usr/bin/env python3
"""Bounded provider-only Qwen/Groq compact Planner compatibility QA."""
from __future__ import annotations
import ftplib,io,json,os,re,ssl,subprocess
from pathlib import Path
from urllib.error import HTTPError,URLError
from urllib.parse import urlsplit
from urllib.request import Request,urlopen
MODEL='qwen/qwen3.8-27b'
SOURCE='222aec89067cc534e95f6a7665fc41798ac2024d'
CASES=(
 ('vi_services_second','Trong danh sách lĩnh vực dịch vụ trên trang chủ PTSC, mục đứng thứ hai là gì? Chỉ nêu tên của mục đó.'),
 ('en_services_second','Which service area is listed second in the PTSC homepage section? Give only its exact name.'),
 ('vi_clients_last','Trong danh sách khách hàng tiêu biểu trên trang chủ PTSC, mục đứng cuối cùng là gì? Chỉ nêu tên của mục đó.'),
 ('en_clients_last','Which featured customer is listed last in the PTSC homepage section? Give only its exact name.'),
 ('vi_projects_paraphrase','Những công trình khẳng định năng lực PPS là gì?'),
 ('en_projects_paraphrase',"Which projects demonstrate PPS's capabilities?"),
)
SAFE={'invalid_json','direct_response','plan_shape','requires_synthesis_type','step_shape','unknown_skill','unknown_action','unknown_param','invalid_param_type','param_conflict','transport_error','empty_response'}
def envv(name):
 p=re.compile(r'^\s*(?:export\s+)?'+re.escape(name)+r'\s*=\s*(.*)\s*$');v=[]
 for line in os.environ.get('ENV_FILE','').splitlines():
  m=p.match(line)
  if m:
   x=m.group(1).strip()
   if len(x)>=2 and x[0]==x[-1] and x[0] in "'\"":x=x[1:-1]
   v.append(x)
 return v[0] if len(v)==1 else ''
def key():
 direct=envv('GROQ_API_KEY')
 if direct:return direct
 raw=os.environ.get('FTP_SERVER','').strip();raw=raw if '://' in raw else 'ftp://'+raw;fu=urlsplit(raw);wu=urlsplit(envv('WC_URL'))
 if not fu.hostname or fu.scheme not in ('ftp','ftps') or fu.port not in (None,21) or fu.username or fu.password or fu.path.strip('/') or wu.scheme!='https' or not wu.hostname or wu.path not in ('','/') or wu.query or wu.fragment:raise RuntimeError('unsafe config')
 root=f'/domains/{wu.hostname}/public_html';f=ftplib.FTP_TLS(context=ssl.create_default_context(),timeout=25)
 try:
  f.connect(fu.hostname,fu.port or 21);f.auth();f.login(os.environ['FTP_USERNAME'],os.environ['FTP_PASSWORD']);f.prot_p();f.cwd(root);b=io.BytesIO();f.retrbinary('RETR wp-config.php',b.write)
 finally:
  try:f.quit()
  except Exception:pass
 t=b.getvalue().decode('utf-8',errors='replace');m=re.search(r"define\s*\(\s*['\"]GROQ_API_KEY['\"]\s*,\s*(['\"])(.*?)\1\s*\)",t,re.S)
 if not m or not m.group(2).strip():raise RuntimeError('Groq key unavailable')
 return m.group(2).strip()
def call(k,system,user):
 payload={'model':MODEL,'messages':[{'role':'system','content':system},{'role':'user','content':user}],'temperature':0.1,'max_tokens':600,'response_format':{'type':'json_object'}}
 req=Request('https://api.groq.com/openai/v1/chat/completions',data=json.dumps(payload,separators=(',',':'),ensure_ascii=False).encode(),headers={'Content-Type':'application/json','Authorization':'Bearer '+k,'User-Agent':'PTSCPS-groq-qwen-compact-probe/1.0'},method='POST')
 try:
  with urlopen(req,timeout=25) as r:code,raw=r.status,r.read(300000)
 except HTTPError as e:code,raw=e.code,e.read(300000)
 except (URLError,TimeoutError):return 0,'','transport_error',{}
 try:
  o=json.loads(raw);text=o.get('choices',[{}])[0].get('message',{}).get('content','') if isinstance(o,dict) else ''
  err='';usage={}
  if isinstance(o,dict):
   u=o.get('usage');
   if isinstance(u,dict):
    for k2 in ('prompt_tokens','completion_tokens','total_tokens'):
     if isinstance(u.get(k2),int):usage[k2]=u[k2]
  if code!=200 and isinstance(o,dict):
   e=o.get('error');err=str(e.get('type') or e.get('code') or '')[:40] if isinstance(e,dict) else ''
  return code,text if isinstance(text,str) else '',err,usage
 except Exception:return code,'','invalid_json',{}
def validate(raw):
 if not raw:return {'valid':False,'reason':'empty_response','skill':'','action':'','mode':''}
 p=subprocess.run(['php','scripts/ptscps-agent-cloudflare-planner-helper.php','source-php','validate'],input=raw,text=True,capture_output=True,timeout=15)
 if p.returncode!=0:raise RuntimeError('validator failed')
 x=json.loads(p.stdout);x['reason']=x.get('reason') if x.get('reason') in SAFE or not x.get('reason') else 'other';return x
def main():
 prompt=subprocess.run(['php','scripts/ptscps-agent-compact-planner-helper.php','source-php'],text=True,capture_output=True,timeout=20,check=True).stdout;k=key();strict='\nLẦN TRƯỚC BỊ TỪ CHỐI. Chỉ trả đúng JSON theo OUTPUT; requires_synthesis ở cấp ngoài cùng.';results=[]
 for cid,q in CASES:
  attempts=[];ok=False
  for n in (1,2):
   code,raw,provider_error,usage=call(k,prompt+(strict if n==2 else ''),q);v=validate(raw);expected=bool(v.get('valid') and v.get('skill')=='knowledge' and v.get('action')=='search' and v.get('mode')=='collection')
   item={'attempt':n,'http_status':code,'provider_error':provider_error,'valid_plan':bool(v.get('valid')),'expected_route':expected,'reason':str(v.get('reason') or '')[:40],'skill':str(v.get('skill') or '')[:32],'action':str(v.get('action') or '')[:32],'mode':str(v.get('mode') or '')[:24]}
   item.update({k3:v3 for k3,v3 in usage.items() if isinstance(v3,int)});attempts.append(item)
   if expected:ok=True;break
   if code!=200:break
  results.append({'case':cid,'status':'PASS' if ok else 'FAIL','attempts':attempts});print('PTSCPS_GROQ_QWEN_COMPACT_CASE='+json.dumps({'case':cid,'status':results[-1]['status'],'attempts':len(attempts)},sort_keys=True))
 report={'schema':1,'scope':'groq_qwen38_compact_planner_contract_six_cases','source_php':SOURCE,'model':MODEL,'prompt_chars':len(prompt),'results':results,'summary':{'total':6,'passed':sum(x['status']=='PASS' for x in results),'failed':sum(x['status']=='FAIL' for x in results)},'notes':['Provider-only bounded QA; no Agent chat or CMS/index mutation.','No credential, raw prompt/question, provider response text, source fact or session persisted.']}
 out=Path('audit/ptscps-agent-groq-qwen-compact-probe-summary.json');out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,indent=2,sort_keys=True)+'\n');print('PTSCPS_GROQ_QWEN_COMPACT_SUMMARY='+json.dumps(report['summary'],sort_keys=True))
 if report['summary']['passed']<6:raise SystemExit(1)
if __name__=='__main__':main()
