import os, sys, json
from pathlib import Path
backend=Path('backend').resolve(); sys.path.insert(0,str(backend)); os.environ.setdefault('DJANGO_SETTINGS_MODULE','config.settings')
import django
django.setup()
from django.apps import apps
from django.db import connection
from django.db.migrations.loader import MigrationLoader
from django.db.models import NOT_PROVIDED

def typ(f):
    try: return f.db_type(connection)
    except Exception: return f.get_internal_type()
def defval(f):
    if f.default is NOT_PROVIDED: return None
    if callable(f.default): return getattr(f.default,'__name__','callable')
    return repr(f.default)
models=[]
for m in apps.get_models(include_auto_created=True):
    if m._meta.proxy: continue
    fields=[]
    for f in m._meta.local_fields:
        rel=f.remote_field.model._meta.db_table if f.is_relation and not f.many_to_many else None
        fields.append({'name':f.column,'field_name':f.name,'type':typ(f),'pk':f.primary_key,'null':f.null,'unique':f.unique,'db_index':f.db_index,'default':defval(f),'relation':rel,'on_delete':str(f.remote_field.on_delete.__name__) if f.is_relation and f.remote_field and f.many_to_one else None})
    for f in m._meta.local_many_to_many:
        fields.append({'name':f.name,'field_name':f.name,'type':'M2M (through '+f.remote_field.through._meta.db_table+')','pk':False,'null':False,'unique':False,'db_index':False,'default':None,'relation':f.remote_field.model._meta.db_table,'on_delete':None})
    constraints=[]
    for c in m._meta.constraints:
        constraints.append({'name':c.name,'type':type(c).__name__,'definition':str(c)})
    indexes=[{'name':ix.name,'fields':ix.fields,'expressions':[str(e) for e in ix.expressions],'condition':str(ix.condition) if ix.condition else None} for ix in m._meta.indexes]
    models.append({'app':m._meta.app_label,'model':m.__name__,'table':m._meta.db_table,'managed':m._meta.managed,'fields':fields,'constraints':constraints,'indexes':indexes})
loader=MigrationLoader(None,ignore_no_migrations=True)
migrations={app:sorted(name for (a,name) in loader.disk_migrations if a==app) for app in sorted({a for a,n in loader.disk_migrations})}
out={'db_vendor_from_config':connection.vendor,'models':models,'migrations':migrations}
Path('tmp/pdfs/model_schema.json').write_text(json.dumps(out,indent=2,default=str),encoding='utf-8')
print(json.dumps({'vendor':connection.vendor,'model_tables':len(models),'migrations_by_app':{k:len(v) for k,v in migrations.items()}}))
