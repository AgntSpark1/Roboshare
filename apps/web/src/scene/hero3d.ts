// @ts-nocheck -- ported verbatim from the approved prototype (apps/web-preview); a visual effect with no data inputs.
/* Hero scene: a generic robotaxi with a roof LiDAR dome on a scrolling neon street. Decorative only (aria-hidden). */
import * as THREE from "three";

export function startHero3d(cv, stage, tagEls, reduce){
  let R;try{R=new THREE.WebGLRenderer({canvas:cv,antialias:true,alpha:true,powerPreference:'high-performance'})}catch(e){return ()=>{}}
  let stopped=false;const ac=new AbortController();
  R.setClearColor(0x000000,0);R.outputColorSpace=THREE.SRGBColorSpace;R.toneMapping=THREE.ACESFilmicToneMapping;R.toneMappingExposure=1.15;
  const scene=new THREE.Scene();scene.fog=new THREE.Fog(0x060B1A,14,52);
  const cam=new THREE.PerspectiveCamera(34,1,.1,200);
  const CY=0x3CF0FF,VI=0x8B7BFF;
  const add=(m,o)=>{(o||scene).add(m);return m};
  const glowMat=(c,o)=>new THREE.LineBasicMaterial({color:c,transparent:true,opacity:o,blending:THREE.AdditiveBlending,depthWrite:false});
  function radialTex(stops){const c=document.createElement('canvas');c.width=c.height=256;const g=c.getContext('2d'),gr=g.createRadialGradient(128,128,0,128,128,128);stops.forEach(([o,col])=>gr.addColorStop(o,col));g.fillStyle=gr;g.fillRect(0,0,256,256);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t}
  function linTex(){const c=document.createElement('canvas');c.width=256;c.height=4;const g=c.getContext('2d'),gr=g.createLinearGradient(0,0,256,0);gr.addColorStop(0,'rgba(200,245,255,.9)');gr.addColorStop(1,'rgba(200,245,255,0)');g.fillStyle=gr;g.fillRect(0,0,256,4);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t}

  // lights
  add(new THREE.HemisphereLight(0x9fb4ff,0x050914,.5*Math.PI));
  const key=add(new THREE.DirectionalLight(0xbfe9ff,1.1*Math.PI));key.position.set(6,9,5);
  const rimC=add(new THREE.PointLight(CY,3.2*Math.PI,14,1));rimC.position.set(-3,2.2,3.5);
  const rimV=add(new THREE.PointLight(VI,3.2*Math.PI,14,1));rimV.position.set(2.5,2.6,-3.5);

  // environment map for paint reflections (studio strips)
  {const env=new THREE.Scene();env.add(new THREE.Mesh(new THREE.SphereGeometry(20,32,16),new THREE.MeshBasicMaterial({color:0x0a1124,side:THREE.BackSide})));
   const strip=(c,w,h,x,y,z,ry)=>{const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({color:c,side:THREE.DoubleSide}));m.position.set(x,y,z);m.lookAt(0,0,0);env.add(m)};
   strip(0xffffff,18,2.2,0,12,0);strip(0xdfe9ff,14,1.2,0,8,9);strip(0x3CF0FF,10,3,-13,3,4);strip(0x8B7BFF,10,3,12,4,-6);strip(0xffffff,6,1,8,6,8);strip(0x223366,30,6,0,-6,0);
   const pm=new THREE.PMREMGenerator(R);scene.environment=pm.fromScene(env,.03).texture;pm.dispose()}
  // car: modern robotaxi crossover, front = +x
  const car=add(new THREE.Group());
  const taper=(g,top,bot,plan)=>{const p=g.attributes.position;for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i);let k=1-top*Math.min(1,Math.max(0,(y-bot)/.6));const ex=Math.max(0,Math.abs(x)-1.55)/.8;k*=1-plan*ex*ex;p.setZ(i,p.getZ(i)*k)}g.computeVertexNormals()};
  const lo=new THREE.Shape();
  lo.moveTo(-2.1,.34);lo.quadraticCurveTo(-2.3,.36,-2.32,.56);lo.bezierCurveTo(-2.34,.8,-2.3,.95,-2.12,1.0);lo.lineTo(1.25,.99);lo.bezierCurveTo(1.7,.97,2.05,.9,2.22,.8);lo.quadraticCurveTo(2.36,.7,2.34,.5);lo.quadraticCurveTo(2.32,.36,2.15,.34);
  lo.lineTo(1.92,.34);lo.absarc(1.45,.42,.47,-.17,Math.PI+.17,false);lo.lineTo(-.98,.34);lo.absarc(-1.45,.42,.47,-.17,Math.PI+.17,false);lo.lineTo(-2.1,.34);
  const bodyG=new THREE.ExtrudeGeometry(lo,{depth:1.6,bevelEnabled:true,bevelThickness:.14,bevelSize:.09,bevelSegments:6,curveSegments:40});bodyG.translate(0,0,-.8);taper(bodyG,.0,9,.2);
  const paint=new THREE.MeshPhysicalMaterial({color:0xE8ECF4,metalness:.35,roughness:.22,clearcoat:1,clearcoatRoughness:.06,envMapIntensity:1.25});
  add(new THREE.Mesh(bodyG,paint),car);
  const gh=new THREE.Shape();
  gh.moveTo(-2.05,.96);gh.bezierCurveTo(-1.95,1.2,-1.75,1.42,-1.35,1.5);gh.bezierCurveTo(-.6,1.6,.2,1.6,.45,1.52);gh.bezierCurveTo(.8,1.4,1.1,1.15,1.4,.96);gh.lineTo(-2.05,.96);
  const ghG=new THREE.ExtrudeGeometry(gh,{depth:1.46,bevelEnabled:true,bevelThickness:.1,bevelSize:.05,bevelSegments:6,curveSegments:40});ghG.translate(0,0,-.73);taper(ghG,.28,.95,.15);
  const glass=new THREE.MeshPhysicalMaterial({color:0x05070d,metalness:.6,roughness:.04,clearcoat:1,clearcoatRoughness:.02,envMapIntensity:1.8});
  add(new THREE.Mesh(ghG,glass),car);
  // lower cladding + rocker light strip
  const clad=new THREE.MeshStandardMaterial({color:0x10141c,metalness:.4,roughness:.55});
  [-1,1].forEach(s=>{const m=add(new THREE.Mesh(new THREE.BoxGeometry(2.0,.1,.04),clad),car);m.position.set(0,.4,s*.93);
    const l=add(new THREE.Mesh(new THREE.BoxGeometry(1.9,.016,.012),new THREE.MeshBasicMaterial({color:CY})),car);l.position.set(0,.47,s*.955)});
  // door decal
  {const c=document.createElement('canvas');c.width=512;c.height=96;const g=c.getContext('2d');g.font='600 46px "Chakra Petch", "Noto Sans SC", sans-serif';g.fillStyle='#0b1530';g.fillText('ROBOTAXI',8,62);g.fillStyle='#16a6c0';g.fillRect(268,30,4,40);g.font='500 34px "JetBrains Mono", monospace';g.fillText('L4 · RS',290,60);
   const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=4;
   [-1,1].forEach(s=>{const m=add(new THREE.Mesh(new THREE.PlaneGeometry(1.25,.235),new THREE.MeshBasicMaterial({map:tex,transparent:true})),car);m.position.set(-.1,.66,s*.942);if(s<0)m.rotation.y=Math.PI})}
  // light bars
  const bar=(w,c,x,y,h)=>{const m=add(new THREE.Mesh(new THREE.BoxGeometry(.03,h||.05,w),new THREE.MeshBasicMaterial({color:c})),car);m.position.set(x,y,0);return m};
  bar(1.5,0xF2FDFF,2.3,.74,.045);const tail=bar(1.62,0xFF2A4D,-2.36,.9,.05);
  // sensors: front bumper lidar, fender pods, mirror cameras
  const sensorMat=new THREE.MeshPhysicalMaterial({color:0x0b0f18,metalness:.5,roughness:.15,clearcoat:1});
  {const m=add(new THREE.Mesh(new THREE.BoxGeometry(.06,.1,.34),sensorMat),car);m.position.set(2.36,.52,0)}
  [[1.62,.99,.78],[1.62,.99,-.78],[-1.85,1.0,.8],[-1.85,1.0,-.8]].forEach(([x,y,z])=>{const g=new THREE.Group();g.position.set(x,y,z);car.add(g);
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(.075,.085,.16,24),sensorMat));const d=new THREE.Mesh(new THREE.SphereGeometry(.075,20,10,0,Math.PI*2,0,Math.PI/2),sensorMat);d.position.y=.08;g.add(d);
    const r=new THREE.Mesh(new THREE.TorusGeometry(.08,.008,6,24),new THREE.MeshBasicMaterial({color:CY}));r.rotation.x=Math.PI/2;r.position.y=-.02;g.add(r)});
  [1,-1].forEach(s=>{const m=add(new THREE.Mesh(new THREE.BoxGeometry(.2,.09,.12),sensorMat),car);m.position.set(1.08,1.06,s*.92)});
  // wheels: aero covers
  const wheels=[];
  const tireM=new THREE.MeshStandardMaterial({color:0x0a0b0f,roughness:.85}),rimM=new THREE.MeshPhysicalMaterial({color:0x2a3140,metalness:.9,roughness:.25,clearcoat:1});
  [[1.45,.8],[1.45,-.8],[-1.45,.8],[-1.45,-.8]].forEach(([x,z])=>{const w=add(new THREE.Group(),car);w.position.set(x,.42,z);const s=z>0?1:-1;
    const tire=new THREE.Mesh(new THREE.CylinderGeometry(.4,.4,.27,48),tireM);tire.rotation.x=Math.PI/2;w.add(tire);
    const rim=new THREE.Mesh(new THREE.CylinderGeometry(.29,.29,.02,48),rimM);rim.rotation.x=Math.PI/2;rim.position.z=s*.136;w.add(rim);
    const ring=new THREE.Mesh(new THREE.TorusGeometry(.29,.012,8,48),new THREE.MeshBasicMaterial({color:CY}));ring.position.z=s*.145;w.add(ring);
    const sp=new THREE.Group();for(let i=0;i<6;i++){const b=new THREE.Mesh(new THREE.BoxGeometry(.035,.5,.01),new THREE.MeshStandardMaterial({color:0x8fa3c8,metalness:.9,roughness:.2}));b.rotation.z=i*Math.PI/6*2;sp.add(b)}sp.position.z=s*.15;w.add(sp);
    wheels.push(w)});
  // roof sensor tower (lidar dome)
  const lid=add(new THREE.Group(),car);lid.position.set(-.45,1.58,0);
  {const base=new THREE.Mesh(new THREE.BoxGeometry(1.0,.07,.8),sensorMat);lid.add(base);
   const legs=new THREE.Mesh(new THREE.CylinderGeometry(.3,.36,.2,40),sensorMat);legs.position.y=.13;lid.add(legs);
   const band=new THREE.Mesh(new THREE.CylinderGeometry(.305,.305,.04,40),new THREE.MeshBasicMaterial({color:CY}));band.position.y=.19;lid.add(band);
   const dome=new THREE.Mesh(new THREE.SphereGeometry(.27,40,16,0,Math.PI*2,0,Math.PI/2),new THREE.MeshPhysicalMaterial({color:0x0e1420,metalness:.3,roughness:.05,clearcoat:1,transparent:true,opacity:.92}));dome.position.y=.23;lid.add(dome)}
  const head=new THREE.Mesh(new THREE.CylinderGeometry(.14,.14,.12,32),new THREE.MeshBasicMaterial({color:CY}));head.position.y=.38;lid.add(head);
  const halo=new THREE.Sprite(new THREE.SpriteMaterial({map:radialTex([[0,'rgba(60,240,255,.9)'],[.3,'rgba(60,240,255,.22)'],[1,'rgba(60,240,255,0)']]),blending:THREE.AdditiveBlending,depthWrite:false}));halo.scale.set(1.2,1.2,1);halo.position.y=.38;lid.add(halo);
  // laser fan
  const fan=add(new THREE.Group());fan.position.set(-.45,1.96,0);
  {const pts=[];for(let i=0;i<46;i++){const a=i/46*Math.PI*.55-.27,r=11+Math.random()*3;pts.push(0,0,0,Math.cos(a)*r,-1.96,Math.sin(a)*r)}
   const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pts,3));fan.add(new THREE.LineSegments(g,glowMat(CY,.16)))}
  // under glow + headlight beam
  const under=add(new THREE.Mesh(new THREE.PlaneGeometry(7,4.2),new THREE.MeshBasicMaterial({map:radialTex([[0,'rgba(60,240,255,.55)'],[.45,'rgba(100,120,255,.18)'],[1,'rgba(0,0,0,0)']]),transparent:true,blending:THREE.AdditiveBlending,depthWrite:false})));under.rotation.x=-Math.PI/2;under.position.y=.02;
  const beamG=new THREE.BufferGeometry();beamG.setAttribute('position',new THREE.Float32BufferAttribute([2.4,.03,-.7, 2.4,.03,.7, 12,.03,-3.2, 12,.03,3.2],3));beamG.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,0,1,1,0,1,1],2));beamG.setIndex([0,2,1,1,2,3]);
  add(new THREE.Mesh(beamG,new THREE.MeshBasicMaterial({map:linTex(),transparent:true,opacity:.32,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide})));

  // ground grid (scrolls)
  const grid=add(new THREE.GridHelper(200,100,0x1d3a7a,0x13244d));grid.material.transparent=true;grid.material.opacity=.55;
  // road edges + dashes
  [-1.6,1.6].forEach(z=>{const m=add(new THREE.Mesh(new THREE.PlaneGeometry(200,.05),new THREE.MeshBasicMaterial({color:CY,transparent:true,opacity:.7})));m.rotation.x=-Math.PI/2;m.position.set(0,.01,z)});
  const dashes=add(new THREE.Group());
  for(let i=0;i<40;i++)[-4.8,4.8].forEach(z=>{const m=new THREE.Mesh(new THREE.PlaneGeometry(1.4,.08),new THREE.MeshBasicMaterial({color:0xF6B53D,transparent:true,opacity:.55}));m.rotation.x=-Math.PI/2;m.position.set(-40+i*4,.012,z);dashes.add(m)});
  // wireframe city
  const blds=[];const bMat=glowMat(0x2c58b8,.55),bMat2=glowMat(VI,.5),fillMat=new THREE.MeshBasicMaterial({color:0x070d1f,transparent:true,opacity:.85});
  for(let i=0;i<46;i++){const w=1.6+Math.random()*3,h=1.5+Math.random()*(Math.random()<.2?13:6),d=1.6+Math.random()*3;const g=new THREE.BoxGeometry(w,h,d);g.translate(0,h/2,0);
    const grp=add(new THREE.Group());grp.add(new THREE.Mesh(g,fillMat));grp.add(new THREE.LineSegments(new THREE.EdgesGeometry(g),Math.random()<.18?bMat2:bMat));
    const side=i%2?1:-1;grp.position.set(-60+Math.random()*120,0,side*(8+Math.random()*12));blds.push(grp)}
  // lidar point cloud on ground
  const N=2400,pp=new Float32Array(N*3),pc=new Float32Array(N*3),pr=new Float32Array(N);
  for(let i=0;i<N;i++){const a=Math.random()*Math.PI*2,r=2.6+Math.pow(Math.random(),.7)*15;pr[i]=r;pp[i*3]=Math.cos(a)*r;pp[i*3+1]=.03+Math.random()*.05;pp[i*3+2]=Math.sin(a)*r}
  const cloudG=new THREE.BufferGeometry();cloudG.setAttribute('position',new THREE.BufferAttribute(pp,3));cloudG.setAttribute('color',new THREE.BufferAttribute(pc,3));
  add(new THREE.Points(cloudG,new THREE.PointsMaterial({size:.07,vertexColors:true,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false})));
  // speed streaks
  const SN=60,sp=new Float32Array(SN*6),sv=[];
  const resetStreak=(i,x)=>{const y=.15+Math.random()*3.2,z=(Math.random()<.5?-1:1)*(1.9+Math.random()*7),l=1+Math.random()*4;sv[i]={x:x??(20+Math.random()*30),y,z,l,v:.35+Math.random()*.5}};
  for(let i=0;i<SN;i++)resetStreak(i,-30+Math.random()*60);
  const stG=new THREE.BufferGeometry();stG.setAttribute('position',new THREE.BufferAttribute(sp,3));
  add(new THREE.LineSegments(stG,glowMat(0x8fe9ff,.45)));

  // sizing + framing
  let W=1,H=1,narrow=false;
  function size(){W=stage.clientWidth;H=stage.clientHeight;narrow=W<820;R.setPixelRatio(Math.min(2,devicePixelRatio||1));R.setSize(W,H,false);cam.aspect=W/H;
    if(narrow)cam.setViewOffset(W,H,0,-H*.04,W,H);else cam.setViewOffset(W,H,-W*.2,H*.02,W,H);cam.updateProjectionMatrix()}
  size();addEventListener('resize',size,{signal:ac.signal});
  // pointer parallax
  const ptr={x:0,y:0,tx:0,ty:0};
  addEventListener('pointermove',e=>{ptr.tx=e.clientX/innerWidth*2-1;ptr.ty=e.clientY/innerHeight*2-1},{passive:true,signal:ac.signal});
  // tags
  const tags=[[tagEls[0],new THREE.Vector3(-.45,2.0,0),[26,-30]],[tagEls[1],new THREE.Vector3(2.35,.74,.6),[26,-6]],[tagEls[2],new THREE.Vector3(-1.45,.02,.95),[18,48]]];
  const v=new THREE.Vector3();
  let visible=true,t0=performance.now(),last=t0;
  const io=new IntersectionObserver(es=>{visible=es[0].isIntersecting;if(visible&&!reduce&&!stopped)requestAnimationFrame(frame)});io.observe(stage);
  function frame(now){
    if(stopped)return;
    const t=(now-t0)/1000,dt=Math.min(.05,(now-last)/1000);last=now;
    const speed=reduce?0:6;
    ptr.x+=(ptr.tx-ptr.x)*.04;ptr.y+=(ptr.ty-ptr.y)*.04;
    const a=.78+Math.sin(t*.12)*.38+ptr.x*.22,r=narrow?12.2:9.4;
    cam.position.set(Math.cos(a)*r,(narrow?3.4:3.1)+Math.sin(t*.2)*.25-ptr.y*.5,Math.sin(a)*r);cam.lookAt(.2,.85,0);
    car.position.y=Math.sin(t*9)*.008;
    wheels.forEach(w=>w.rotation.z-=speed*dt/.39);
    head.rotation.y+=dt*8;fan.rotation.y=Math.sin(t*1.4)*.5;halo.material.opacity=.7+Math.sin(t*6)*.3;
    tail.material.color.setHSL(.98,1,.5+Math.sin(t*3)*.1);
    grid.position.x=-((t*speed)%2);dashes.position.x=-((t*speed)%4);
    blds.forEach(b=>{b.position.x-=speed*dt;if(b.position.x<-60)b.position.x+=120});
    // lidar wave
    const wave=(t*7)%18;
    for(let i=0;i<N;i++){const d=pr[i]-wave,k=Math.exp(-d*d*1.2)*1.1+.06+Math.exp(-(pr[i]-2.6)*1.4)*.25;pc[i*3]=.24*k;pc[i*3+1]=.94*k;pc[i*3+2]=1*k}
    cloudG.attributes.color.needsUpdate=true;
    for(let i=0;i<SN;i++){const s=sv[i];s.x-=s.v*speed*dt*6;if(s.x+s.l<-30)resetStreak(i);sp.set([s.x,s.y,s.z,s.x+s.l,s.y,s.z],i*6)}
    stG.attributes.position.needsUpdate=true;
    R.render(scene,cam);
    tags.forEach(([el,p,o])=>{v.copy(p).project(cam);const x=Math.min((v.x*.5+.5)*W+o[0],W-el.offsetWidth-10),y=(-v.y*.5+.5)*H+o[1]+(narrow&&el===tagEls[1]?78:0);
      el.style.transform=`translate(${x|0}px,${y|0}px) translateY(-50%)`;el.classList.toggle('on',t>1.2&&x>30&&!(narrow&&el===tagEls[2]))});
    if(visible&&!reduce&&!document.hidden)requestAnimationFrame(frame)}
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&visible&&!reduce)requestAnimationFrame(frame)},{signal:ac.signal});
  requestAnimationFrame(frame);if(reduce)setTimeout(()=>frame(t0+2000),50);
  return ()=>{stopped=true;ac.abort();io.disconnect();R.dispose()};
}

