import json
from collections import Counter
live=json.load(open('tmp/pdfs/live_schema_metadata.json')); model=json.load(open('tmp/pdfs/model_schema.json'))
disk={(a,n) for a,names in model['migrations'].items() for n in names}; applied={(x['app'],x['name']) for x in live['applied_migrations']}
print('migration totals disk/applied/unapplied:',len(disk),len(applied),len(disk-applied),'unexpected applied',len(applied-disk))
print('public tables/columns/constraints/indexes:',len(live['tables']),sum(len(t['columns']) for t in live['tables']),sum(len(t['constraints']) for t in live['tables']),sum(len(t['indexes']) for t in live['tables']))
print('constraint types',Counter(c['type'] for t in live['tables'] for c in t['constraints']))
print('tables:')
for t in live['tables']:
 print(f"{t['name']:42} cols={len(t['columns']):2} constraints={len(t['constraints']):2} indexes={len(t['indexes']):2} rls={t['row_level_security_enabled']}")
