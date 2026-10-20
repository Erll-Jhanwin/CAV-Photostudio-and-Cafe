import os,sys,json
from pathlib import Path
backend=Path('backend').resolve(); sys.path.insert(0,str(backend)); os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings')
import django; django.setup()
from django.db import connection
p=Path('tmp/pdfs/live_schema_metadata.json'); result=json.loads(p.read_text(encoding='utf-8'))
with connection.cursor() as c:
    for table in result['tables']:
        name=table['name']
        c.execute("""SELECT con.conname, con.contype, pg_get_constraintdef(con.oid),
          ARRAY(SELECT a.attname FROM unnest(con.conkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=k.attnum ORDER BY k.ord),
          rel2.relname,
          ARRAY(SELECT a.attname FROM unnest(con.confkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=con.confrelid AND a.attnum=k.attnum ORDER BY k.ord)
          FROM pg_constraint con JOIN pg_class rel ON rel.oid=con.conrelid JOIN pg_namespace ns ON ns.oid=rel.relnamespace
          LEFT JOIN pg_class rel2 ON rel2.oid=con.confrelid
          WHERE ns.nspname='public' AND rel.relname=%s ORDER BY con.conname""",[name])
        cs=[]
        labels={'p':'PRIMARY KEY','f':'FOREIGN KEY','u':'UNIQUE','c':'CHECK','x':'EXCLUSION'}
        for n,t,definition,cols,rt,rc in c.fetchall():
            cs.append({'name':n,'type':labels.get(t,t),'definition':definition,'columns':list(cols or []),'references_table':rt,'references_columns':list(rc or [])})
        table['constraints']=cs
        c.execute("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=%s ORDER BY indexname",[name])
        table['indexes']=[{'name':r[0],'definition':r[1]} for r in c.fetchall()]
        c.execute("SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=%s",[name])
        table['row_level_security_enabled']=bool(c.fetchone()[0])
    c.execute("SELECT tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname")
    result['policies']=[{'table':r[0],'name':r[1],'permissive':r[2],'roles':r[3],'command':r[4],'using':r[5],'with_check':r[6]} for r in c.fetchall()]
p.write_text(json.dumps(result,indent=2,default=str),encoding='utf-8')
print(json.dumps({'tables':len(result['tables']),'constraints':sum(len(t['constraints']) for t in result['tables']),'indexes':sum(len(t['indexes']) for t in result['tables']),'policies':len(result['policies']),'rls_tables':sum(t['row_level_security_enabled'] for t in result['tables'])}))
