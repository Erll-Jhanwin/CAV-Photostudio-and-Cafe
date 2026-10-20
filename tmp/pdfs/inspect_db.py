import os, sys, json
from pathlib import Path
backend = Path('backend').resolve()
sys.path.insert(0, str(backend))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
try:
    import django
    django.setup()
    from django.db import connection
    if connection.vendor != 'postgresql':
        print(json.dumps({'status':'no-postgresql-target','vendor':connection.vendor})); raise SystemExit(0)
    result={'status':'connected-read-only-schema-inspection','tables':[],'policies':[],'applied_migrations':[]}
    with connection.cursor() as c:
        c.execute("""SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name""")
        tables=[r[0] for r in c.fetchall()]
        for table in tables:
            c.execute("""SELECT column_name, data_type, udt_name, is_nullable, column_default, character_maximum_length, numeric_precision, numeric_scale FROM information_schema.columns WHERE table_schema='public' AND table_name=%s ORDER BY ordinal_position""",[table])
            cols=[{'name':r[0],'data_type':r[1],'udt':r[2],'nullable':r[3]=='YES','default':r[4],'max_length':r[5],'precision':r[6],'scale':r[7]} for r in c.fetchall()]
            c.execute("""SELECT tc.constraint_name, tc.constraint_type, kcu.column_name, ccu.table_name AS foreign_table, ccu.column_name AS foreign_column, chk.check_clause FROM information_schema.table_constraints tc LEFT JOIN information_schema.key_column_usage kcu ON tc.constraint_schema=kcu.constraint_schema AND tc.constraint_name=kcu.constraint_name AND tc.table_name=kcu.table_name LEFT JOIN information_schema.constraint_column_usage ccu ON tc.constraint_schema=ccu.constraint_schema AND tc.constraint_name=ccu.constraint_name LEFT JOIN information_schema.check_constraints chk ON tc.constraint_schema=chk.constraint_schema AND tc.constraint_name=chk.constraint_name WHERE tc.table_schema='public' AND tc.table_name=%s ORDER BY tc.constraint_name, kcu.ordinal_position""",[table])
            cons=[{'name':r[0],'type':r[1],'column':r[2],'references_table':r[3],'references_column':r[4],'check':r[5]} for r in c.fetchall()]
            c.execute("""SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=%s ORDER BY indexname""",[table])
            idx=[{'name':r[0],'definition':r[1]} for r in c.fetchall()]
            c.execute("""SELECT rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename=%s""",[table])
            rls=bool(c.fetchone()[0])
            result['tables'].append({'name':table,'columns':cols,'constraints':cons,'indexes':idx,'row_level_security_enabled':rls})
        c.execute("""SELECT tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname""")
        result['policies']=[{'table':r[0],'name':r[1],'permissive':r[2],'roles':r[3],'command':r[4],'using':r[5],'with_check':r[6]} for r in c.fetchall()]
        c.execute('SELECT app, name, applied FROM django_migrations ORDER BY app, name')
        result['applied_migrations']=[{'app':r[0],'name':r[1],'applied':r[2].isoformat() if r[2] else None} for r in c.fetchall()]
    Path('tmp/pdfs/live_schema_metadata.json').write_text(json.dumps(result,indent=2,default=str),encoding='utf-8')
    print(json.dumps({'status':result['status'],'table_count':len(result['tables']),'policy_count':len(result['policies']),'applied_migration_count':len(result['applied_migrations']),'rls_enabled_tables':sum(t['row_level_security_enabled'] for t in result['tables'])}))
except SystemExit: raise
except Exception as e:
    # Avoid printing exception detail because a DB driver may embed a connection URL.
    print(json.dumps({'status':'inspection-failed','exception_type':type(e).__name__}))
