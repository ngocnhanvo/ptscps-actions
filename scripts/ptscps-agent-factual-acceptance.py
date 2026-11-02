#!/usr/bin/env python3
"""Read-only, data-driven live acceptance for public PTSCPS TablePress collections.

Never prints or stores raw Agent replies, visitor chats, credentials, or cookies.
"""
import hashlib
import html
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import sys
import time
import unicodedata
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, quote
from urllib.request import Request, urlopen

CASES = (
    ('vi_services', 'vi', 'home_01', 'Những lĩnh vực dịch vụ nào được giới thiệu trên trang chủ PTSC?'),
    ('en_services', 'en', 'home_01_en', "Which service areas are listed on PTSC's homepage?"),
    ('vi_clients', 'vi', 'home_15', 'Những khách hàng tiêu biểu nào được giới thiệu trên trang chủ PTSC?'),
    ('en_clients', 'en', 'home_15_en', 'Which featured customers are shown on the PTSC homepage?'),
)

class Tags(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.words = []
        self.alts = []
    def handle_data(self, s):
        self.words.append(s)
    def handle_starttag(self, tag, attrs):
        if tag == 'img':
            attr = dict(attrs)
            if attr.get('alt'): self.alts.append(attr['alt'])

def plain(value):
    p = Tags()
    p.feed(str(value or ''))
    return ' '.join(' '.join(p.words).split()), [a.strip() for a in p.alts if a.strip()]

def normalized(value):
    s = unicodedata.normalize('NFD', str(value).lower().replace('đ', 'd'))
    s = ''.join(x for x in s if unicodedata.category(x) != 'Mn')
    return re.sub(r'\s+', ' ', re.sub('[^a-z0-9 ]+', ' ', s)).strip()

def origin(name, host):
    rows = [s.strip().removeprefix('export ') for s in os.environ['ENV_FILE'].splitlines()]
    found = [s.split('=', 1)[1].strip().strip('"\'') for s in rows if s.startswith(name + '=')]
    if len(found) != 1: raise ValueError('Missing or duplicate URL config ' + name)
    x = urlsplit(found[0])
    if x.scheme != 'https' or x.hostname != host or x.port or x.path not in ('', '/') or x.query or x.fragment or x.username or x.password:
        raise ValueError('Unexpected production origin ' + name)
    return x.scheme + '://' + x.netloc

def load_json(url, data=None, timeout=40):
    headers = {'Accept':'application/json', 'User-Agent':'PTSCPS-readonly-factual-acceptance/1.0'}
    if data is not None: headers['Content-Type'] = 'application/json'
    try:
        with urlopen(Request(url, data=json.dumps(data).encode() if data is not None else None,
                             headers=headers, method='POST' if data is not None else 'GET'), timeout=timeout) as res:
            return res.status, json.loads(res.read(750000))
    except HTTPError as e:
        return e.code, {}
    except (URLError, TimeoutError, ValueError):
        return 0, {}

def extract_labels(table):
    labels=[]
    unlabelled=0
    for index, item in enumerate(table['items']):
        if not isinstance(item,dict): raise ValueError('Invalid TablePress item')
        # CMS row title is authoritative; fallback to image alt only where title absent.
        title, _ = plain(item.get('title',''))
        if not title:
            alts=[]
            for field in ('image', 'logo', 'icon'):
                if field in item:
                    _, a = plain(item[field])
                    alts.extend(a)
            title = next((a for a in alts if a), '')
        title = html.unescape(title).strip()
        if not normalized(title):
            unlabelled+=1
            continue
        if normalized(title) not in [normalized(s) for s in labels]:
            labels.append(title)
    return labels, unlabelled

def run():
    wp=origin('WC_URL','admin-ptscps.thegioihosting.io.vn')
    fe=origin('WC_URL_CLIENT','ptscps.thegioihosting.io.vn')
    output={'schema':1, 'scope':'read_only_public_published_tablepress',
            'baseline_php_sha':'bfee57bdbe0fbe9d1199a8ab33927cf029a86d79',
            'cases':[], 'notes':['Public CMS labels only; agent response bodies never retained.',
                                  'Full fidelity needs expected list coverage and no unverified extra claims.']}
    for case,language,table_id,question in CASES:
        status, table=load_json(wp+'/wp-json/tablepress/v1/table/'+quote(table_id),timeout=30)
        if status != 200 or not isinstance(table,dict) or table.get('success') is not True or table.get('id')!=table_id or not isinstance(table.get('items'),list):
            output['cases'].append({'id':case,'status':'BLOCKED_SOURCE','table_id':table_id,'source_http':status})
            continue
        labels, unlabelled=extract_labels(table)
        start=time.monotonic()
        code, resp=load_json(fe+'/api/agent/chat',{'message':question,'language':language},timeout=90)
        reply=resp.get('reply','') if isinstance(resp,dict) else ''
        if not isinstance(reply,str): reply=''
        ans=normalized(reply)
        matched=[s for s in labels if normalized(s) in ans]
        missing=[s for s in labels if normalized(s) not in ans]
        insufficient=(not labels or unlabelled>0)
        locale_fail=(language=='en' and bool(re.search(r'\b(?:khách hàng|dịch vụ|của chúng tôi)\b',reply.lower())))
        fallback=bool(re.search(r'(no verified information|chưa có thông tin xác thực|không tìm thấy dữ liệu xác thực|the system cannot process)',reply.lower()))
        result='PASS' if code==200 and not missing and not insufficient and not locale_fail and not fallback else 'FAIL'
        record={'id':case,'status':result,'table_id':table_id,'source_http':status,
                'source_rows':len(table['items']), 'reference_labels':labels,
                'unlabelled_rows':unlabelled, 'agent_http':code,'answer_chars':len(reply),
                'answer_sha256':hashlib.sha256(reply.encode('utf-8')).hexdigest(),
                'expected_count':len(labels),'matched_labels':matched,'missing_labels':missing,
                'locale_fail':locale_fail,'fallback':fallback, 'elapsed_ms':int((time.monotonic()-start)*1000),
                'coverage':round(len(matched)/len(labels),3) if labels else 0}
        output['cases'].append(record)
        print('PTSCPS_FACTUAL_ACCEPTANCE '+json.dumps({k:record[k] for k in ('id','status','table_id','source_rows','expected_count','coverage','agent_http','answer_chars','unlabelled_rows')},ensure_ascii=False))
    return output

if __name__=='__main__':
    p=Path('audit/ptscps-agent-factual-acceptance-report.json')
    p.parent.mkdir(parents=True, exist_ok=True)
    try:
        report=run()
    except Exception as exc:
        report={'schema':1,'status':'BLOCKED','error_type':type(exc).__name__}
    report['summary']={'passed':sum(x.get('status')=='PASS' for x in report.get('cases',[])),
                      'total':len(report.get('cases',[]))}
    p.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    if report['summary']!={'passed':4,'total':4}:
        print('PTSCPS_AGENT_FACTUAL_ACCEPTANCE=FAIL report=artifact')
        sys.exit(1)
    print('PTSCPS_AGENT_FACTUAL_ACCEPTANCE=PASS 4/4 (source label coverage only)')
