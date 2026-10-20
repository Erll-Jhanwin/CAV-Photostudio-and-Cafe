import json,re
live=json.load(open('tmp/pdfs/live_schema_metadata.json')); model=json.load(open('tmp/pdfs/model_schema.json'))
lm={t['name']:t for t in live['tables']}; mm={m['table']:m for m in model['models']}
print('table set delta',set(lm)-set(mm),set(mm)-set(lm))
for name in sorted(set(lm)&set(mm)):
 cols={c['name']:c for c in lm[name]['columns']}; fields={f['name']:f for f in mm[name]['fields'] if 'M2M' not in f['type']}
 extras=set(cols)-set(fields); missing=set(fields)-set(cols)
 mism=[]
 for n in set(cols)&set(fields):
  d=cols[n]; t=fields[n]['type']; dt=d['data_type']; compat=(t.startswith('bigint') and dt=='bigint') or (t.startswith('integer') and dt=='integer') or (t.startswith('smallint') and dt=='smallint') or (t.startswith('boolean') and dt=='boolean') or (t.startswith('text') and dt=='text') or (t.startswith('jsonb') and dt=='jsonb') or (t.startswith('date') and dt=='date') or (t.startswith('time') and dt=='time without time zone') or (t.startswith('timestamp') and dt=='timestamp with time zone') or (t.startswith('numeric') and dt=='numeric') or ((t.startswith('varchar') or t.startswith('character varying')) and dt=='character varying')
  if not compat: mism.append((n,t,dt,d['udt']))
 if extras or missing or mism: print(name,'extra',sorted(extras),'missing',sorted(missing),'type',mism)
