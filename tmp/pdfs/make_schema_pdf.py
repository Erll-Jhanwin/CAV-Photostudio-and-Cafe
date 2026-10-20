import json, re, textwrap, unicodedata
from pathlib import Path

W,H=960,680
PDF=Path('output/pdf/database_schema_documentation.pdf')
live=json.loads(Path('tmp/pdfs/live_schema_metadata.json').read_text(encoding='utf-8'))
model=json.loads(Path('tmp/pdfs/model_schema.json').read_text(encoding='utf-8'))
mods={m['table']:m for m in model['models']}
ops=[]; pages=[]; page_no=0

def asc(v): return unicodedata.normalize('NFKD',str(v or '')).encode('ascii','ignore').decode('ascii').replace('\t',' ')
def esc(s): return asc(s).replace('\\','\\\\').replace('(','\\(').replace(')','\\)')
def yp(t): return H-t
def line(x1,t1,x2,t2,w=.7): ops.append(f'{w} w {x1:.2f} {yp(t1):.2f} m {x2:.2f} {yp(t2):.2f} l S')
def rect(x,t,w,h,fill=False,lw=.7): ops.append(f'{lw} w {x:.2f} {H-t-h:.2f} {w:.2f} {h:.2f} re {"f" if fill else "S"}')
def txt(x,t,s,sz=9,bold=False,white=False):
    ops.append('1 g' if white else '0 g')
    ops.append(f'BT /{"F2" if bold else "F1"} {sz:.2f} Tf 1 0 0 1 {x:.2f} {yp(t):.2f} Tm ({esc(s)}) Tj ET')
def wr(s,n): return textwrap.wrap(asc(s),width=max(8,n),break_long_words=True,break_on_hyphens=False) or ['']
def start(title,sub,source):
    global ops,page_no,src
    ops=['1 J 1 j 0 G 0 g',f'0 g 0 {H-88} {W} 88 re f']
    txt(36,27,'CAV PHOTO STUDIO & CAFE  |  DATABASE REFERENCE',9,True,True)
    txt(36,56,title,21,True,True); txt(36,76,sub,8.5,False,True)
    ops.append('0 g'); line(36,98,W-36,98,.9); src=source; page_no+=1
def end():
    line(36,649,W-36,649,.65); txt(36,665,asc(src)[:160],6.5); txt(W-58,665,str(page_no),7.5,True)
    pages.append('\n'.join(ops))
def node(x,t,w,h,name,details):
    rect(x,t,w,h,False,1); txt(x+7,t+14,name,8,True); line(x+6,t+19,x+w-6,t+19,.55)
    yy=t+31
    for item in details:
        for row in wr(item,max(13,int((w-14)/3.7))):
            if yy>t+h-4: break
            txt(x+7,yy,row,6.7); yy+=8
def arrow(x1,t1,x2,t2,label='',lx=None,lt=None):
    import math
    line(x1,t1,x2,t2,.9); a=math.atan2(yp(t2)-yp(t1),x2-x1); L=6; px=x2; py0=yp(t2)
    p1=(px-L*math.cos(a-.48),py0-L*math.sin(a-.48)); p2=(px-L*math.cos(a+.48),py0-L*math.sin(a+.48))
    ops.append(f'{px:.2f} {py0:.2f} m {p1[0]:.2f} {p1[1]:.2f} l {p2[0]:.2f} {p2[1]:.2f} l h f')
    if label: txt(lx if lx is not None else (x1+x2)/2,lt if lt is not None else (t1+t2)/2-4,label,6.5,True)
def dtype(c):
    t=c['data_type']
    if t=='character varying': return f"varchar({c['max_length']})" if c['max_length'] else 'varchar'
    if t=='character': return f"char({c['max_length']})" if c['max_length'] else 'char'
    if t=='numeric' and c['precision'] is not None: return f"numeric({c['precision']},{c['scale'] or 0})"
    if t=='ARRAY': return c['udt']+'[]'
    if t=='USER-DEFINED': return c['udt']
    return t
def appof(table):
    if table.startswith('django_'): return 'Django framework'
    if table.startswith('auth_'): return 'Django authentication'
    if table.startswith('token_blacklist_'): return 'SimpleJWT token blacklist'
    return {'users':'Accounts & privacy','booking':'Booking','inventory':'Inventory','payment':'Payments','pos':'Point of sale','forecasting':'Forecasting','notifications':'Notifications','audit':'Audit'}.get(table.split('_',1)[0],table)

desc={
'django_admin_log':'Django admin change history; user and content-type references.','auth_permission':'Django model permissions; each row belongs to a content type.',
'auth_group_permissions':'Many-to-many join between auth groups and permissions.','auth_group':'Django permission groups.','django_content_type':'Django model registry used by permissions and admin logs.',
'django_session':'Django session storage; serialized session payload.','token_blacklist_outstandingtoken':'SimpleJWT outstanding token records; optional user FK.',
'token_blacklist_blacklistedtoken':'One-to-one blacklist record for an outstanding token.','users_customuser_groups':'Many-to-many join between CustomUser and auth_group.',
'users_customuser_user_permissions':'Many-to-many join between CustomUser and auth_permission.','users_customuser':'Django AbstractUser with CUSTOMER, STAFF and ADMIN application roles.',
'users_customer':'Optional one-to-one loyalty/customer profile.','users_privacyconsent':'Versioned privacy and service-processing consent records.',
'users_privacyrequest':'Customer access/correction/deletion/objection/export requests and status.','users_passwordresetotp':'Phone/email reset OTP lifecycle; hashes, attempts and expiry.',
'booking_service':'Bookable service catalogue, duration and base price.','booking_package':'Priced package belonging to one Service.',
'booking_booking':'Customer reservation; items and history are JSON; active-slot and idempotency guards.',
'booking_bookingreview':'Review, one-to-one with Booking and customer-linked.','booking_bookingdatelock':'Per-date serialization lock for concurrent booking creation.',
'booking_studiounavailabledate':'Admin-managed studio closure date; optional creator account.',
'inventory_category':'Category reference; current Product.category is not a database FK.','inventory_supplier':'Supplier catalog; Product.supplier is not a database FK.',
'inventory_product':'Unified PRODUCT/INGREDIENT row; recipe and supplier/category snapshots are scalar or JSON.',
'inventory_inventoryevent':'Stock, ingredient and purchase-order event; product/user FKs are nullable.',
'payment_payment':'Shared booking/POS payment. CHECK enforces exactly one booking or order parent.',
'pos_order':'POS order/EOD payload; line_items, report_data and print_status are JSON snapshots.',
'forecasting_saleshistoryimport':'Validated, hash-deduplicated CSV batch; one active snapshot per source.',
'forecasting_saleshistoryrecord':'Normalized CSV row; import batch uses PROTECT on delete.',
'notifications_notification':'In-app notification; optional booking FK and unique event_key.',
'notifications_pushsubscription':'Per-user Web Push endpoint; unique per user and endpoint.',
'notifications_notificationdelivery':'Email/SMS/push provider lifecycle and retries; optional user/notification links.',
'audit_auditlog':'Application audit events; model blocks ordinary deletes.','django_migrations':'Django migration ledger; all repository migrations are present as applied.'
}
keys={}; fkmap={}; fields={}
for m in model['models']:
    for f in m['fields']: fields[(m['table'],f['name'])]=f
for t in live['tables']:
    by={}; cm={c['name']:c for c in t['columns']}
    for c in t['constraints']:
        if c['type']=='PRIMARY KEY':
            for col in c['columns']: by.setdefault(col,[]).append('PK')
        if c['type']=='FOREIGN KEY':
            for i,col in enumerate(c['columns']):
                ref=c['references_columns'][i] if i<len(c['references_columns']) else '?'
                fkmap[(t['name'],col)]=(c['references_table'],ref)
                by.setdefault(col,[]).append('FK')
        if c['type']=='UNIQUE' and len(c['columns'])==1: by.setdefault(c['columns'][0],[]).append('UQ')
    for ix in t['indexes']:
        if ix['definition'].startswith('CREATE UNIQUE INDEX'):
            for col in cm:
                if re.search(r'\b'+re.escape(col)+r'\b',ix['definition']): by.setdefault(col,[]).append('UQ')
    keys[t['name']]=by

start('Database Schema Documentation','Observed PostgreSQL schema, ER diagrams and module-level data ownership.','Evidence: live public PostgreSQL catalog; Django models/migrations; backend/docs/supabase-rls.sql')
txt(48,135,'LIVE CATALOG SNAPSHOT',10,True)
facts=[('PUBLIC TABLES',str(len(live['tables']))),('COLUMNS',str(sum(len(t['columns']) for t in live['tables']))),('CONSTRAINTS',str(sum(len(t['constraints']) for t in live['tables']))),('INDEXES',str(sum(len(t['indexes']) for t in live['tables']))),('MIGRATIONS','90 / 90 applied'),('ROW-LEVEL SECURITY','disabled on 34 / 34 tables')]
for i,(k,v) in enumerate(facts):
    x=48+(i%3)*288; y=158+(i//3)*82; rect(x,y,264,60,False,1); txt(x+10,y+22,k,8,True); txt(x+10,y+45,v,13,True)
rect(48,340,864,108,False,1); txt(60,360,'Scope and method',11,True)
for i,s in enumerate(['Columns, types, defaults, nullability, constraints, indexes, foreign keys, migration ledger and RLS state were read from live public PostgreSQL using read-only catalog queries.','The live schema was compared with Django models and repository migrations. Migration records match all 90 repository migration files; one live type difference is documented below.','No row data or credential values are included. No database or application state was changed.']): txt(60,380+i*19,s,8.5)
rect(48,466,864,132,False,1); txt(60,487,'Observed schema difference',11,True)
for i,s in enumerate(['Live auth_group_permissions.id is PostgreSQL bigint; the Django-derived implicit join-table id is integer. The live type is documented as authoritative.','Matching migration history does not prove there is no manual schema drift.','The older backend/docs/database_erd.md shows retired tables and relationships; this document uses the live catalog and current migration state.']): txt(60,510+i*20,s,8.3)
end()

start('ER Diagram 2 - Inventory, notifications and forecasting','The diagram distinguishes physical foreign keys from scalar identifiers and JSON snapshots.','Source: live pg_constraint; inventory, notifications, forecasting and audit models')
arrow(390,171,490,171,'1 : 0..N',413,161)
arrow(703,210,719,311,'0..1 : 0..N',710,265)
arrow(861,348,861,475,'1 : 0..N',868,413)
arrow(174,360,222,360,'1 : 0..N',180,350)
arrow(382,382,500,485,'0..1 : 0..N',395,445)
arrow(703,510,382,550,'0..1 : 0..N',510,535)
arrow(174,330,500,180,'1 : 0..N',300,242)
arrow(861,348,703,510,'1 : 0..N',790,432)
arrow(382,550,500,550,'1 : 0..N',405,540)
node(24,140,150,68,'inventory_category',['PK id; no FK from Product'])
node(24,245,150,68,'inventory_supplier',['PK id; no FK from Product'])
node(222,140,168,96,'inventory_product',['PK id; SKU unique','category/supplier are integer refs','recipe_data is JSON'])
node(490,140,213,96,'inventory_inventoryevent',['PK id; optional FK product_id','optional FK user_id'])
node(24,330,150,68,'booking_booking',['External entity: ERD 1'])
node(222,330,160,90,'notifications_notification',['FK user_id; optional booking_id'])
node(500,465,203,88,'notifications_notificationdelivery',['optional FK notification_id','optional FK user_id'])
node(24,465,150,76,'notifications_pushsubscription',['FK user_id; unique user/endpoint'])
node(770,285,182,80,'users_customuser',['PK id'])
node(770,475,182,80,'audit_auditlog',['optional FK user_id'])
node(222,510,160,80,'forecasting_saleshistoryimport',['hash unique; one active/source'])
node(500,545,203,70,'forecasting_saleshistoryrecord',['FK import_batch_id; unique source row'])
txt(24,597,'Product.category/supplier, recipe ingredient IDs, and POS line-item references are not physical FKs; they are integer or JSON values.',8,True)
end()

start('ER Diagram 3 - Identity, access and framework tables','Join tables implement Django many-to-many relations; session and migration tables are standalone.','Source: live pg_constraint; users/models.py; Django auth/session/SimpleJWT migrations')
arrow(206,165,333,283,'1 : 0..1',235,220); arrow(206,270,333,310,'1 : 0..N',235,281)
arrow(206,366,333,330,'1 : 0..N',235,348); arrow(206,464,333,354,'1 : 0..N',235,416)
arrow(487,166,487,260,'0..N : 1',496,215); arrow(487,376,487,406,'0..N : 1',497,392)
arrow(642,166,703,260,'1 : 0..N',645,212); arrow(703,300,642,424,'1 : 0..N',655,357)
arrow(800,300,800,380,'1 : 0..N',808,340); arrow(800,461,800,505,'1 : 0..1',808,489)
arrow(206,550,703,424,'0..1 : 0..N',380,500); arrow(206,550,703,285,'1 : 0..N',442,405)
arrow(642,300,703,300,'1 : 0..N',648,290)
node(44,130,162,70,'users_customer',['unique FK user_id'])
node(44,235,162,70,'users_privacyconsent',['FK user_id; unique consent version'])
node(44,330,162,70,'users_privacyrequest',['FK user_id'])
node(44,430,162,70,'users_passwordresetotp',['FK user_id'])
node(44,520,162,62,'django_migrations',['PK id; no FKs'])
node(333,260,154,110,'users_customuser',['PK id; application role field','email / phone unique if nonblank'])
node(333,130,154,72,'users_customuser_groups',['M2M join: user_id + group_id'])
node(333,400,154,72,'users_customuser_user_permissions',['M2M join: user_id + permission_id'])
node(642,130,154,72,'auth_group',['PK id; name unique'])
node(703,260,194,80,'auth_permission',['FK content_type_id','unique content_type/codename'])
node(703,380,194,80,'auth_group_permissions',['M2M join: group_id + permission_id'])
node(642,500,154,72,'django_content_type',['unique app_label/model'])
node(44,520,162,62,'django_admin_log',['user/content_type FKs'])
node(835,130,110,72,'django_session',['No FKs'])
node(835,260,110,82,'token_blacklist_outstandingtoken',['optional FK user_id'])
node(835,380,110,80,'token_blacklist_blacklistedtoken',['one-to-one FK token_id'])
rect(44,598,901,30,False,.7)
txt(54,617,'Standalone: django_session stores session payload; django_migrations tracks applied migrations. users_customer is optional one-to-one.',7.8,True)
end()

# All physical FK rows with cardinality and configured delete action.
fkrows=[]
for t in live['tables']:
    cm={c['name']:c for c in t['columns']}; unique=set()
    for c in t['constraints']:
        if c['type']=='UNIQUE' and len(c['columns'])==1: unique.update(c['columns'])
    for ix in t['indexes']:
        if ix['definition'].startswith('CREATE UNIQUE INDEX'):
            for col in cm:
                if re.search(r'\b'+re.escape(col)+r'\b',ix['definition']): unique.add(col)
    for c in t['constraints']:
        if c['type']!='FOREIGN KEY': continue
        for i,col in enumerate(c['columns']):
            ref=c['references_columns'][i] if i<len(c['references_columns']) else '?'
            f=fields.get((t['name'],col),{})
            fkrows.append((t['name'],col,c['references_table'],ref,f.get('on_delete') or 'see DB definition',
                           '0..1' if cm[col]['nullable'] or col in unique else '1',
                           '0..1' if col in unique else '0..N'))
start('Physical Foreign Key Register','All live FK constraints with parent/child cardinality and Django delete behavior where defined.','Source: live pg_constraint; current Django field on_delete configuration')
txt(44,125,f'{len(fkrows)} physical foreign keys; parent rows may have no children unless a child FK is unique.',9,True)
for ci,subset in enumerate((fkrows[::2],fkrows[1::2])):
    x=44+ci*454; y=151; txt(x,y,'Child column -> parent | cardinality | delete',8,True); y+=13; line(x,y,x+430,y,.6); y+=10
    for child,col,parent,ref,on,childmax,parentmax in subset:
        s=f'{child}.{col} -> {parent}.{ref} | child->parent {childmax}; parent->child {parentmax} | {on}'
        for r in wr(s,90): txt(x,y,r,7.1); y+=9
        y+=2
end()

# Module persistence mapping.
start('Module Data Ownership','Persisted module tables and intentionally non-persisted runtime modules.','Sources: backend/apps/*/models.py and views.py; backend/ml; live schema')
modsmap=[
('Users / auth','users_customuser, users_customer, users_privacyconsent, users_privacyrequest, users_passwordresetotp; auth_group, auth_permission and joins; token_blacklist_*; django_session','Identity, roles, customer profile, privacy, OTP, Django auth and JWT revocation.'),
('Booking','booking_service, booking_package, booking_booking, booking_bookingreview, booking_bookingdatelock, booking_studiounavailabledate','Services, packages, scheduled reservations, review, concurrency locks and blocked dates; booking items/history are JSON.'),
('Payments / POS','payment_payment, pos_order','Shared payment attaches to Booking OR Order by CHECK. POS line_items, EOD report and print data are JSON.'),
('Inventory','inventory_category, inventory_supplier, inventory_product, inventory_inventoryevent','PRODUCT and INGREDIENT use one Product table; InventoryEvent records movements. Category/supplier IDs are scalar.'),
('Forecasting','forecasting_saleshistoryimport, forecasting_saleshistoryrecord','Validated CSV batches and normalized rows. Forecast predictions are computed on demand, not stored.'),
('Notifications / audit','notifications_notification, notifications_pushsubscription, notifications_notificationdelivery, audit_auditlog, django_admin_log','In-app/push/delivery states and audit history. Some notification FKs are optional.'),
('No dedicated tables','chatbot, gallery, reports, dashboard, sales','Chatbot knowledge and gallery content are code/static API data; dashboard/report values aggregate operational rows at request time.')]\ny=126
for name,tables,desc0 in modsmap:
    rect(44,y,872,62,False,.7); txt(54,y+16,name,8.3,True)
    txt(195,y+15,tables,7.0,True)
    for j,r in enumerate(wr(desc0,133)[:2]): txt(195,y+34+j*9,r,7.1)
    y+=69
end()

start('Live Database Policies and Supabase Configuration','Live row-level security state is separated from the optional repository SQL setup script.','Sources: live pg_class.relrowsecurity and pg_policies; backend/docs/supabase-rls.sql; settings.py')
rect(44,124,420,111,False,1); txt(56,145,'LIVE PUBLIC SCHEMA',10,True)
for i,s in enumerate(['RLS enabled: 0 of 34 tables','Policies in public: 0','Repository SQL policy script is not reflected in live catalog.','Table/sequence grants were not inferred from policy metadata.']): txt(56,166+i*16,s,8.1)
rect(490,124,426,111,False,1); txt(502,145,'APPLICATION ACCESS',10,True)
for i,s in enumerate(['Django uses DATABASE_URL / SUPABASE_DATABASE_URL.','PostgreSQL SSL is required by default.','DRF default: CookieJWTAuthentication + IsAuthenticated.','API role checks and row filters run in Django.']): txt(502,166+i*16,s,8.1)
txt(44,267,'Optional backend/docs/supabase-rls.sql behavior if an operator runs it:',10,True)
for i,s in enumerate(['REVOKE ALL on public tables and sequences from Supabase anon and authenticated roles.',
'For only its listed tables: enable RLS, replace <table>_backend_only and allow all commands for cav_backend using USING (true) and WITH CHECK (true).',
'The script does not create grants for cav_backend; the role and grants must be provisioned separately.',
'It is a backend-only policy, not a per-user policy; application RBAC remains in Django.']):
    txt(54,289+i*17,s,8.1)
policy=['users_customuser','users_customer','users_passwordresetotp','booking_service','booking_package','booking_booking','booking_bookingdatelock','booking_studiounavailabledate','payment_payment','pos_order','inventory_product','inventory_inventoryevent','audit_auditlog','notifications_notification','notifications_pushsubscription','notifications_notificationdelivery']
rect(44,374,872,105,False,.7); txt(54,393,'Tables targeted by the optional script (16)',9,True)
for i,name in enumerate(policy): txt(56+(i//8)*420,411+(i%8)*8.3,name,6.7)
rect(44,500,872,130,False,.8); txt(54,520,'Integrity rules and modeling notes',9,True)
for i,s in enumerate(['Important database guards include active booking slot uniqueness, booking idempotency, payment XOR parent, case-insensitive payment reference, one active forecast batch per source and unique imported source row.',
'Product.category and supplier are positive integer fields with nonnegative checks, not FKs. Recipe IDs and POS line items are JSON snapshots.',
'Supabase RLS is disabled in the observed database. API RBAC and CORS do not imply database row-level security.']):
    txt(54,544+i*23,s,7.7)
end()

start('ER Diagram 1 - Booking, POS and payments','Solid arrows are physical FKs. Labels show parent-to-child cardinality; catalog pages list exact columns and actions.','Source: live pg_constraint; backend/apps/{booking,payment,pos,users}/models.py')
arrow(410,176,462,176,'1 : 0..N',414,166); arrow(622,176,694,275,'1 : 0..N',635,215)
arrow(194,302,694,302,'1 : 0..N',420,292); arrow(730,345,624,394,'1 : 0..1',644,366)
arrow(786,345,786,449,'1 : 0..N',795,402); arrow(624,531,694,489,'1 : 0..N',640,510)
arrow(694,320,624,535,'0..1 : 0..N',635,430); arrow(194,335,474,535,'1 : 0..N',310,450)
arrow(194,345,260,390,'1 : 0..N',206,368)
node(40,260,154,100,'users_customuser',['PK id; CUSTOMER / STAFF / ADMIN'])
node(260,140,150,72,'booking_service',['PK id'])
node(462,140,160,72,'booking_package',['PK id; FK service_id'])
node(694,260,190,88,'booking_booking',['PK id; FK customer_id, package_id','JSON items / change_history'])
node(464,385,160,72,'booking_bookingreview',['unique FK booking_id; FK customer_id'])
node(694,445,190,80,'payment_payment',['FK booking_id OR order_id','CHECK payment_has_one_parent'])
node(464,500,160,76,'pos_order',['optional FK booking_id / staff_id'])
node(260,485,160,62,'booking_bookingdatelock',['unique scheduled_date; no FK'])
node(260,375,170,88,'booking_studiounavailabledate',['unique date; optional FK created_by_id'])
txt(45,610,'BookingDateLock is a concurrency row keyed by date, not a foreign-key child. Payment uses one shared table with an XOR parent check.',8.5,True)
end()
