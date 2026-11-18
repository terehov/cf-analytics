import csv,sys,re,json,time,urllib.request,urllib.error
liste,tokfile,out=sys.argv[1:4]
T=open(tokfile).read().strip(); B="https://api3.foodnotify.com"
IDS={"erpId":"7984","connectionId":"2052","accountId":"2052","mappingId":"2052","accountIdentifier":"2052","costCenterId":"7911","restaurantId":"7846","userId":"10616"}
SKIP=re.compile(r'/pos/sync/|/pos/export/|shoppingList|/carts(?!/count)|eventOrder|/api/1\.0/')
def shape(x,d=0):
    if isinstance(x,dict): return {k:(shape(v,d+1) if d<3 else type(v).__name__) for k,v in list(x.items())[:40]}
    if isinstance(x,list): return [len(x), shape(x[0],d+1) if x else None]
    return type(x).__name__
rows=[r for r in csv.DictReader(open(liste,encoding="utf-8")) if r["messen"]=="ja"]
w=csv.writer(open(out,"w",encoding="utf-8",newline="")); w.writerow(["pfad","aufruf","status","content_type","bytes","meldung","form"])
n=0
for r in rows:
    p=r["pfad"]
    if SKIP.search(p): w.writerow([p,"","nicht gemessen","","","vom Hauptagenten ausgenommen (Name deutet auf Abgleich/Warenkorb; 1.0 schon gemessen)",""]); continue
    u=re.sub(r'\{(\w+)\}',lambda m: IDS.get(m.group(1),"MISSING"),p)
    if "MISSING" in u: w.writerow([p,"","nicht gemessen","","","Parameter nicht fuellbar",""]); continue
    if re.search(r'/(paginate|search)(/all)?$',u) or "/2.0/" in u: u+="?page=1&page_size=5&perPage=5"
    req=urllib.request.Request(B+u,headers={"Authorization":"Bearer "+T,"Accept":"application/json","User-Agent":"cf-analytics-probe/1.0"})
    try:
        resp=urllib.request.urlopen(req,timeout=45); st=resp.status; ct=resp.headers.get("content-type",""); body=resp.read()
    except urllib.error.HTTPError as e: st=e.code; ct=e.headers.get("content-type",""); body=e.read()
    except Exception as e: w.writerow([p,u,"fehler","","",str(e)[:120],""]); time.sleep(1.2); continue
    msg="";form=""
    try:
        j=json.loads(body)
        if st>=400 and isinstance(j,dict): msg=str(j.get("message") or j.get("detail") or j.get("title") or "")[:160]
        elif st<400: form=json.dumps(shape(j),ensure_ascii=False)[:1500]
    except Exception: msg="kein JSON" if st<400 else ""
    w.writerow([p,u,st,ct.split(";")[0],len(body),msg,form]); n+=1
    if st==429: print("429 - Abbruch"); break
    time.sleep(1.2)
print("gemessen",n)
