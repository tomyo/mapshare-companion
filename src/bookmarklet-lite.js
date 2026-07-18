(()=>{
  const L=window.L;
  const m=window.map||(window.animator&&window.animator.getMap&&window.animator.getMap());
  if(!L||!m){alert('Flymaster My Location: map not ready. Wait until the Flymaster map is visible, then run again.');return;}
  if(window.fmmlLite&&window.fmmlLite.destroy) window.fmmlLite.destroy();

  let watch=null,follow=false,last=null,pts=[];
  const layer=L.layerGroup().addTo(m);
  const track=L.polyline([],{color:'#1a73e8',weight:3,opacity:.85,interactive:false}).addTo(layer);
  let marker=null,circle=null;

  const style=document.createElement('style');
  style.textContent='.fmmlp{background:#ffffffe8;padding:8px;border:2px solid #1a73e8;border-radius:8px;box-shadow:0 2px 10px #0005;font:13px system-ui,sans-serif;max-width:250px}.fmmlp button{margin:3px 3px 0 0;padding:5px 7px;border:1px solid #888;border-radius:6px;background:white}.fmmlw{background:0;border:0}.fmmld{width:28px;height:28px;border-radius:50%;background:#1a73e8;border:3px solid white;box-shadow:0 1px 7px #0008;position:relative}.fmmld:after{content:"";position:absolute;left:8px;top:8px;width:6px;height:6px;border-radius:50%;background:white}.fmmla{position:absolute;left:9px;top:-13px;width:0;height:0;border-left:5px solid #0000;border-right:5px solid #0000;border-bottom:16px solid #1a73e8;transform-origin:50% 27px}';
  document.head.appendChild(style);

  const C=L.Control.extend({onAdd(){
    const d=L.DomUtil.create('div','fmmlp leaflet-bar');
    d.innerHTML='<b id="fmmls">My location</b><div id="fmmld">starting GPS…</div><button id="fmmlc">Center</button><button id="fmmlf">Follow: off</button><button id="fmmlx">Stop</button>';
    L.DomEvent.disableClickPropagation(d);L.DomEvent.disableScrollPropagation(d);
    d.querySelector('#fmmlc').onclick=()=>last&&m.setView([last.lat,last.lon],Math.max(m.getZoom(),15));
    d.querySelector('#fmmlf').onclick=e=>{follow=!follow;e.target.textContent='Follow: '+(follow?'on':'off');if(follow&&last)m.panTo([last.lat,last.lon]);};
    d.querySelector('#fmmlx').onclick=()=>window.fmmlLite.destroy();
    return d;
  }});
  const ctl=new C({position:'topleft'}).addTo(m);

  const dist=(a,b,c,d)=>{const R=6371000,p=Math.PI/180,x=(c-a)*p,y=(d-b)*p,A=Math.sin(x/2)**2+Math.cos(a*p)*Math.cos(c*p)*Math.sin(y/2)**2;return R*2*Math.atan2(Math.sqrt(A),Math.sqrt(1-A));};
  const bear=(a,b,c,d)=>{const p=Math.PI/180,y=Math.sin((d-b)*p)*Math.cos(c*p),x=Math.cos(a*p)*Math.sin(c*p)-Math.sin(a*p)*Math.cos(c*p)*Math.cos((d-b)*p);return(Math.atan2(y,x)*180/Math.PI+360)%360;};
  const icon=h=>L.divIcon({className:'fmmlw',iconSize:[34,34],iconAnchor:[17,17],html:`<div class=fmmld><div class=fmmla style="transform:rotate(${isFinite(h)?h:0}deg);opacity:${isFinite(h)?1:.25}"></div></div>`});

  function ok(p){
    const c=p.coords,n={lat:c.latitude,lon:c.longitude,acc:c.accuracy||0,head:isFinite(c.heading)?c.heading:NaN,speed:isFinite(c.speed)?c.speed:NaN};
    if(!isFinite(n.head)&&last&&dist(last.lat,last.lon,n.lat,n.lon)>3)n.head=bear(last.lat,last.lon,n.lat,n.lon);
    last=n;
    const ll=[n.lat,n.lon];
    if(!marker){marker=L.marker(ll,{icon:icon(n.head),zIndexOffset:5000,title:'My location'}).addTo(layer);}else{marker.setLatLng(ll);marker.setIcon(icon(n.head));}
    if(!circle){circle=L.circle(ll,{radius:n.acc,color:'#1a73e8',weight:2,opacity:.65,fillColor:'#1a73e8',fillOpacity:.12,interactive:false}).addTo(layer);}else{circle.setLatLng(ll);circle.setRadius(n.acc);}
    const lp=pts[pts.length-1];
    if(!lp||dist(lp[0],lp[1],n.lat,n.lon)>8){pts.push(ll);if(pts.length>500)pts.shift();track.setLatLngs(pts);}
    if(follow)m.panTo(ll,{animate:false});
    const sp=isFinite(n.speed)?' · '+(n.speed*3.6).toFixed(0)+' km/h':'';
    document.getElementById('fmmls').textContent='My location: live';
    document.getElementById('fmmld').textContent=n.lat.toFixed(5)+', '+n.lon.toFixed(5)+' ±'+Math.round(n.acc)+' m'+sp;
  }
  function err(e){document.getElementById('fmmls').textContent='My location: error';document.getElementById('fmmld').textContent=e.message||String(e);}
  if(!navigator.geolocation){err({message:'Geolocation not supported'});return;}
  watch=navigator.geolocation.watchPosition(ok,err,{enableHighAccuracy:true,maximumAge:1000,timeout:15000});
  window.fmmlLite={destroy(){if(watch!=null)navigator.geolocation.clearWatch(watch);m.removeControl(ctl);m.removeLayer(layer);style.remove();delete window.fmmlLite;}};
})();
