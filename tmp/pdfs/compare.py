import json
live=json.load(open('tmp/pdfs/live_schema_metadata.json')); model=json.load(open('tmp/pdfs/model_schema.json'))
mm={m['table']:m for m in model['models']}; lm={t['name']:t for t in live['tables']}
print('table counts live/model:',len(lm),len(mm),'missing in model:',sorted(set(lm)-set(mm)),'missing live:',sorted(set(mm)-set(lm)))
print('RLS enabled:',[t['name'] for t in live['tables'] if t['row_level_security_enabled']]); print('Policies:',len(live['policies']))
for name in sorted(set(lm)&set(mm)):
 a={f['name']:f for f in lm[name]['columns']}; b={f['name']:f for f in mm[name]['fields'] if f.get('type','').find('M2M')<0}
 miss=sorted(set(b)-set(a)); extra=sorted(set(a)-set(b)); mism=[]
 for col in set(a)&set(b):
  typ=b[col]['type']; liveType=a[col]['data_type']; exp= 'character varying' if typ.startswith('varchar') or typ.startswith('character varying') else ('timestamp with time zone' if typ=='timestamp with time zone' else typ)
  if typ.startswith('bigint') and liveType=='bigint': exp='bigint'
  if typ.startswith('integer') and liveType=='integer': exp='integer'
  if typ.startswith('smallint') and liveType=='smallint': exp='smallint'
  if typ.startswith('boolean') and liveType=='boolean': exp='boolean'
  if typ.startswith('numeric') and liveType=='numeric': exp='numeric'
  if typ.startswith('text') and liveType=='text': exp='text'
  if typ.startswith('jsonb') and liveType=='jsonb': exp='jsonb'
  if typ.startswith('date') and liveType=='date': exp='date'
  if typ.startswith('time') and liveType=='time without time zone': exp='time without time zone'
  if typ.startswith('timestamp') and liveType=='timestamp with time zone': exp='timestamp with time zone'
  if exp!=liveType: mism.append((col,typ,liveType))
 if miss or extra or mism: print(name,'missing',miss,'extra',extra,'type_mismatch',mism[:4])
