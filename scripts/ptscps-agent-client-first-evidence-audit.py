#!/usr/bin/env python3
"""Read-only source-shape check for the two remaining first-client failures.

Export Boolean evidence-shape metadata only. Never log or persist client names,
website table row values, raw HTML, credentials, sessions, or Agent answers.
"""
import importlib.util
import json
from pathlib import Path
from urllib.parse import quote

lib_path = Path(__file__).with_name('ptscps-agent-fact-intent-grounded.py')
spec = importlib.util.spec_from_file_location('ptscps_fact_grounded', lib_path)
if spec is None or spec.loader is None:
    raise RuntimeError('Source QA evaluator missing')
qa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qa)


def clean_visible(row):
    if not isinstance(row, dict):
        return ''
    pieces = []
    for value in row.values():
        if isinstance(value, str):
            text, _ = qa.as_text(value)
            pieces.append(text)
    return qa.norm(' '.join(pieces))


def inspect(row):
    label = qa.first_label(row)
    title, _ = qa.as_text(row.get('title', ''))
    kind = 'none'
    if title:
        kind = 'title_text'
    else:
        for name in ('image', 'logo', 'icon'):
            _, alts = qa.as_text(row.get(name, ''))
            if alts:
                kind = name + '_alt'
                break
    visible = clean_visible(row)
    norm_label = qa.norm(label)
    return {
        'label_present': bool(norm_label),
        'label_origin': kind,
        'label_preserved_by_strip_tags': bool(norm_label) and (' ' + norm_label + ' ') in (' ' + visible + ' '),
        'first_row_has_any_visible_text': bool(visible),
        'first_row_has_image_html': any('<img' in str(row.get(k,'')) for k in ('image', 'logo', 'icon')),
    }


def main():
    assert inspect({'image':'<img alt="Client Example" src="/a.png">'})['label_preserved_by_strip_tags'] is False
    assert inspect({'title':'Client Example'})['label_preserved_by_strip_tags'] is True
    wp = qa.origin('WC_URL', 'admin-ptscps.thegioihosting.io.vn')
    report = {'schema':1,'scope':'read_only_first_client_table_evidence_shape', 'request_count':2, 'items':[]}
    for lang, table_id in [('vi','home_15'),('en','home_15_en')]:
        code, table = qa.request_json(wp+'/wp-json/tablepress/v1/table/'+quote(table_id),timeout=30)
        entry = {'language':lang,'source_http':code, 'source_valid':False}
        if (code==200 and isinstance(table,dict) and table.get('success') is True and
                table.get('id')==table_id and isinstance(table.get('items'),list) and table['items']):
            first = table['items'][0]
            if isinstance(first,dict):
                entry['source_valid'] = True
                entry['data_rows'] = len(table['items'])
                entry.update(inspect(first))
                entry['rows_with_visible_text'] = sum(bool(clean_visible(row)) for row in table['items'])
                entry['rows_without_visible_text'] = len(table['items'])-entry['rows_with_visible_text']
        report['items'].append(entry)
        print('PTSCPS_CLIENT_SOURCE_SHAPE='+json.dumps(entry,sort_keys=True))
    out = Path('audit/ptscps-agent-client-first-evidence-summary.json')
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(report,indent=2,sort_keys=True)+'\n',encoding='utf-8')
    if not all(x['source_valid'] for x in report['items']):
        raise RuntimeError('Published TablePress source unavailable for diagnosis')


if __name__=='__main__':
    main()
