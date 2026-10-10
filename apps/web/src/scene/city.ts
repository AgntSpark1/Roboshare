// @ts-nocheck -- ported from the approved prototype (apps/web-preview); a decorative simulation, clearly labelled as such.
/* Fleet dispatch simulation on a city grid. Not live data. */

export function startCity(c, reduce, hud){
  let stopped=false;const ac=new AbortController();const x=c.getContext('2d');let W,Hh,dpr,cell,cols,rows,cars=[],pins=[],t0=performance.now();
  function size(){dpr=Math.min(2,devicePixelRatio||1);W=c.clientWidth;Hh=c.clientHeight;c.width=W*dpr;c.height=Hh*dpr;x.setTransform(dpr,0,0,dpr,0,0);cell=Math.max(44,Math.min(70,W/16));cols=Math.ceil(W/cell)+1;rows=Math.ceil(Hh/cell)+1;
    const n=Math.round(cols*rows/7);cars=Array.from({length:Math.min(46,Math.max(16,n))},(_,i)=>mk(i===0));}
  function mk(hero){const gx=Math.random()*cols|0,gy=Math.random()*rows|0,d=[[1,0],[-1,0],[0,1],[0,-1]][Math.random()*4|0];return{gx,gy,dx:d[0],dy:d[1],p:Math.random(),v:(.006+Math.random()*.01)*(hero?.8:1),hero,trail:[]}}
  function step(car){car.p+=car.v;if(car.p>=1){car.p=0;car.gx+=car.dx;car.gy+=car.dy;
      if(car.gx<0||car.gy<0||car.gx>cols||car.gy>rows){Object.assign(car,mk(car.hero),{trail:[]});return}
      if(Math.random()<.4){const o=car.dx?[[0,1],[0,-1]]:[[1,0],[-1,0]];const d=o[Math.random()*2|0];car.dx=d[0];car.dy=d[1]}
      if(Math.random()<.04&&!car.hero)pins.push({x:car.gx*cell,y:car.gy*cell,a:0})}}
  const pos=car=>({x:(car.gx+car.dx*car.p)*cell,y:(car.gy+car.dy*car.p)*cell});
  // offset grid so the right side is the focus
  function draw(now){const t=Math.max(0,(now-t0)/1000);x.clearRect(0,0,W,Hh);
    // blocks
    for(let i=0;i<cols;i++)for(let j=0;j<rows;j++){const k=(i*7+j*13)%11;x.fillStyle=k<2?'#12204A':k<5?'#0D1836':'#0A1228';x.fillRect(i*cell+6,j*cell+6,cell-12,cell-12);
      if(k===3){x.fillStyle='rgba(60,240,255,.07)';x.fillRect(i*cell+12,j*cell+12,cell-24,cell-24)}}
    // streets
    x.strokeStyle='#1A2643';x.lineWidth=1;x.beginPath();for(let i=0;i<=cols;i++){x.moveTo(i*cell,0);x.lineTo(i*cell,Hh)}for(let j=0;j<=rows;j++){x.moveTo(0,j*cell);x.lineTo(W,j*cell)}x.stroke();
    // pins
    pins=pins.filter(p=>p.a<1);pins.forEach(p=>{p.a+=.008;x.strokeStyle=`rgba(79,227,210,${1-p.a})`;x.lineWidth=1.5;x.beginPath();x.arc(p.x,p.y,4+p.a*22,0,7);x.stroke();x.fillStyle=`rgba(79,227,210,${1-p.a})`;x.beginPath();x.arc(p.x,p.y,2.5,0,7);x.fill()});
    // cars
    cars.forEach(car=>{if(!reduce)step(car);const q=pos(car);car.trail.push(q);if(car.trail.length>(car.hero?40:18))car.trail.shift();
      x.lineCap='round';for(let i=1;i<car.trail.length;i++){const a=car.trail[i-1],b=car.trail[i];if(Math.abs(a.x-b.x)+Math.abs(a.y-b.y)>cell)continue;x.strokeStyle=car.hero?`rgba(246,181,61,${i/car.trail.length*.9})`:`rgba(122,167,255,${i/car.trail.length*.45})`;x.lineWidth=car.hero?3:2;x.beginPath();x.moveTo(a.x,a.y);x.lineTo(b.x,b.y);x.stroke()}
      if(car.hero){const r=(t*40)%90;x.strokeStyle=`rgba(79,227,210,${.6-r/150})`;x.lineWidth=1.5;x.beginPath();x.arc(q.x,q.y,r,0,7);x.stroke();
        const ang=t*2.4;x.fillStyle='rgba(79,227,210,.12)';x.beginPath();x.moveTo(q.x,q.y);x.arc(q.x,q.y,80,ang,ang+.6);x.closePath();x.fill();
        x.fillStyle='#F6B53D';x.shadowColor='#F6B53D';x.shadowBlur=16;x.beginPath();x.arc(q.x,q.y,5,0,7);x.fill();x.shadowBlur=0;
        x.font='600 10px JetBrains Mono, monospace';x.fillStyle='#F6B53D';x.fillText('示例车辆 · 载客中',q.x+10,q.y-10)}
      else{x.fillStyle='#BFD2FF';x.beginPath();x.arc(q.x,q.y,2.4,0,7);x.fill()}});
    if(!reduce&&!stopped)requestAnimationFrame(draw)}
  size();addEventListener('resize',()=>{size();if(reduce)draw(performance.now())},{signal:ac.signal});requestAnimationFrame(draw);
  hud?.(cars.length);
  return ()=>{stopped=true;ac.abort()};
}
