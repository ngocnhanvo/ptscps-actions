#!/usr/bin/env python3
"""Scoped read-only production LLM error attribution; never export prompts or answers."""
import ftplib
import io
import json
import os
import re
import ssl
import time
import uuid
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


def env(name):
    rows = [s.strip().removeprefix('export ').strip() for s in os.environ['ENV_FILE'].splitlines()]
    vals = [s.split('=', 1)[1].strip().strip('\"\'') for s in rows if s.startswith(name+'=')]
    if len(vals) != 1: raise ValueError('Required env missing: '+name)
    return vals[0]


def origin(name, host):
    u = urlsplit(env(name))
    if u.scheme != 'https' or u.hostname != host or u.port or u.path not in ('', '/') or u.query or u.fragment:
        raise ValueError('Unexpected origin: '+name)
    return u.scheme+'://'+u.netloc


def safe(value):
    s = str(value or '')
    return s[:100] if re.fullmatch(r'[A-Za-z0-9_.:/@-]{1,100}', s[:100]) else None


def probe(url, case, language, question, runid, wp=False):
    headers = {'Content-Type':'application/json', 'Accept':'application/json',
        'X-ESC-Debug':'regression', 'X-ESC-Run-Id':runid, 'X-ESC-Test-Case':case, 'X-ESC-Test-Turn':'1'}
    if wp:
        try:
            headers['Authorization']='Bearer '+env('WOO_SECRET')
        except ValueError:
            return {'http':None,'skipped':'upstream_credentials_not_available'}
        try: headers['X-ESC-Woo-Key']=env('WOO_KEY')
        except ValueError: pass
    else:
        headers['Origin']=front
    body = json.dumps({'message':question, 'language':language, 'sessionId':str(uuid.uuid4())}).encode()
    start=time.monotonic()
    try:
        with urlopen(Request(url, data=body, headers=headers, method='POST'), timeout=65) as response:
            status=response.status; raw=response.read(8192)
    except HTTPError as e:
        status=e.code; raw=e.read(8192)
    except Exception as e:
        return {'http':0,'transport_error':safe(type(e).__name__),'ms':round((time.monotonic()-start)*1000)}
    try: obj=json.loads(raw)
    except ValueError: obj={}
    if not isinstance(obj,dict):obj={}
    nested=obj.get('error')
    code=obj.get('code') or (nested.get('code') if isinstance(nested,dict) else None)
    reply=obj.get('reply') or obj.get('message')
    return {'http':status,'code':safe(code),'answered':status==200 and isinstance(reply,str) and bool(reply.strip()),
        'ms':round((time.monotonic()-start)*1000)}


wp=origin('WC_URL','admin-ptscps.thegioihosting.io.vn')
front=origin('WC_URL_CLIENT','ptscps.thegioihosting.io.vn')
runid='llmtrace'+os.environ['GITHUB_RUN_ID']
questions=[('vi_services','vi','Những dịch vụ hoạt động chính của PTSC là gì?'),
           ('en_activities','en','What are PTSC main areas of operation?'),
           ('vi_activities','vi','LĨNH VỰC HOẠT ĐỘNG là gì'),
           ('en_services','en','Which service areas does PTSC provide?')]
report={'schema':1,'read_only':True,'run':runid,'source':'ptscps-php@0d9080ac','cases':[], 'traces':{}}
for case,language,question in questions:
    row={'id':case,'language':language,'frontend':probe(front+'/api/agent/chat',case+'-frontend',language,question,runid)}
    # Compare direct WordPress only on failures, using an independent session.
    if not row['frontend']['answered']:
        row['wordpress']=probe(wp+'/wp-json/esc-agent/v1/chat',case+'-wordpress',language,question,runid,True)
    report['cases'].append(row)
    print('AGENT_LLM_OBSERVE '+json.dumps(row,ensure_ascii=False))
    time.sleep(2)

allowed={'llm_request','llm_response','llm_retry','llm_failover','llm_candidate_skipped',
         'llm_provider_cooldown','llm_provider_half_open','llm_provider_recovered','planner_failed',
         'plan_rejected','plan_validated','synthesis_failed','llm_provider_config_invalid','request_end'}
fields={'event','stage','provider','model','resource_id','http_status','error_type','reason',
        'detail','latency_ms','attempt','result','finish_reason','cooldown_until','retry_after_seconds'}
try:
    address=urlsplit(os.environ['FTP_SERVER'] if '://' in os.environ['FTP_SERVER'] else 'ftp://'+os.environ['FTP_SERVER'])
    if address.scheme not in ('ftp','ftps') or not address.hostname or address.path.strip('/'):
        raise ValueError('Invalid FTPS host')
    ftp=ftplib.FTP_TLS(context=ssl.create_default_context(),timeout=25)
    ftp.connect(address.hostname,address.port or 21)
    ftp.auth();ftp.login(os.environ['FTP_USERNAME'],os.environ['FTP_PASSWORD']);ftp.prot_p()
    root='/domains/admin-ptscps.thegioihosting.io.vn/public_html/wp-content/esc-agent-debug/regression/'+runid
    for row in report['cases']:
        for kind in ('frontend','wordpress'):
            if kind not in row:continue
            label=row['id']+'-'+kind
            try:
                ftp.cwd(root+'/'+label)
                events=[]
                for name in ftp.nlst():
                    file=name.rsplit('/',1)[-1]
                    if not re.fullmatch(r'turn-01_req_[0-9a-f]{24}\.jsonl',file):continue
                    data=io.BytesIO();ftp.retrbinary('RETR '+file,data.write)
                    if len(data.getvalue())>256000:continue
                    for line in data.getvalue().splitlines():
                        try: item=json.loads(line)
                        except ValueError:continue
                        if not isinstance(item,dict) or item.get('event') not in allowed:continue
                        events.append({k:safe(v) if isinstance(v,str) else v for k,v in item.items()
                            if k in fields and isinstance(v,(str,int,float,bool,type(None)))})
                report['traces'][label]=events[:70]
            except ftplib.all_errors as e:
                report['traces'][label]={'unavailable':type(e).__name__}
    ftp.quit()
except Exception as e:
    report['ftps_error_type']=type(e).__name__
for name,entries in report['traces'].items():
    print('AGENT_LLM_TRACE '+json.dumps({'case':name,'events':entries},ensure_ascii=False))
Path('audit').mkdir(exist_ok=True)
Path('audit/ptscps-agent-llm-runtime-trace-result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print('AGENT_LLM_OBSERVE_DONE answered='+str(sum(x['frontend']['answered'] for x in report['cases']))+'/4; no production changes')
