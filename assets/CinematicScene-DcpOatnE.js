import{r as c,j as e,X as _,R as U,Y as u}from"./index-BnDhsn2X.js";import{C as I,A as L,u as j,V as M,a as p,b as y,B as O,c as k}from"./react-three-fiber.esm-COzvqvx1.js";const g=9.5,z=-34,x=4.2,l=-2.5,v={top:"#051019",mid:"#06262a",horizon:"#0b423a",beacon:"#6ee7b7"};function S(o){const t=Math.min(1,Math.max(0,o));return 4.8+t*t*(3-2*t)*4.8}const G=`
  float cineHash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float cineNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(cineHash(i + vec3(0.0, 0.0, 0.0)), cineHash(i + vec3(1.0, 0.0, 0.0)), f.x),
          mix(cineHash(i + vec3(0.0, 1.0, 0.0)), cineHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
      mix(mix(cineHash(i + vec3(0.0, 0.0, 1.0)), cineHash(i + vec3(1.0, 0.0, 1.0)), f.x),
          mix(cineHash(i + vec3(0.0, 1.0, 1.0)), cineHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
      f.z);
  }
  float cineFbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * cineNoise(p);
      p *= 2.03;
      a *= 0.5;
    }
    return v;
  }
`,N=`
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`,X=`
  uniform vec3 uTop;
  uniform vec3 uMid;
  uniform vec3 uHorizon;
  uniform vec3 uBeaconColor;
  uniform vec3 uBeaconDir;
  uniform float uBeaconI;
  varying vec3 vWorld;

  float sineBand(vec3 d) {
    return 0.5 + 0.5 * sin(d.x * 2.2 + d.z * 0.8);
  }

  void main() {
    vec3 dir = normalize(vWorld - cameraPosition);
    float h = dir.y;

    vec3 col = mix(uHorizon, uMid, smoothstep(-0.02, 0.32, h));
    col = mix(col, uTop, smoothstep(0.16, 0.92, h));

    // faint emerald aurora hugging the horizon (biophilic signature)
    float aurora = exp(-abs(h) * 14.0) * (0.25 + 0.75 * sineBand(dir));
    col += vec3(0.0022, 0.0160, 0.0120) * aurora * 0.55;

    // restrained clinical wash around the beacon — no ray or bloom layer
    float d = max(dot(dir, uBeaconDir), 0.0);
    float wide = pow(d, 5.0);
    float core = pow(d, 80.0);
    col += uBeaconColor * (wide * 0.045 + core * 0.12) * uBeaconI;

    // horizon haze lifts the campsite out of the dark
    col += vec3(0.0040, 0.0125, 0.0105) * exp(-abs(h) * 6.0) * 0.9;
    col += vec3(0.0070, 0.0078, 0.0060) * exp(-abs(h) * 24.0) * 0.5;

    // below-horizon floor so the dome never shows a seam
    col = mix(col, uHorizon * 0.42, 1.0 - smoothstep(-0.22, 0.0, h));

    // ordered-ish dithering
    float n = fract(sin(dot(dir.xy, vec2(12.9898, 78.233))) * 43758.5453);
    col += (n - 0.5) * 0.006;

    gl_FragColor = vec4(col, 1.0);
  }
`;function Y(){const o=c.useRef(null),{camera:t}=j(),s=c.useMemo(()=>({uTop:{value:new p(v.top)},uMid:{value:new p(v.mid)},uHorizon:{value:new p(v.horizon)},uBeaconColor:{value:new p(v.beacon)},uBeaconDir:{value:new M(0,.05,-1)},uBeaconI:{value:1}}),[]),r=c.useMemo(()=>new M,[]);return y(()=>{o.current&&(r.set(g,S(u.smooth),z),s.uBeaconDir.value.copy(r).sub(t.position).normalize())}),e.jsxs("mesh",{renderOrder:-2,frustumCulled:!1,scale:[1,1,1],children:[e.jsx("sphereGeometry",{args:[180,32,20]}),e.jsx("shaderMaterial",{ref:o,uniforms:s,vertexShader:N,fragmentShader:X,side:O,depthWrite:!1,toneMapped:!1})]})}function V(){const o=c.useRef(null),t=c.useRef([]),s=c.useMemo(()=>Array.from({length:24},(r,n)=>{const a=n/24*Math.PI*2;return{angle:a,x:Math.cos(a),y:Math.sin(a),major:n%6===0}}),[]);return y(r=>{o.current&&(o.current.position.y=S(u.smooth),o.current.scale.setScalar(1+u.smooth*.08)),u.reduced||t.current.forEach((n,a)=>{n&&(n.rotation.z=r.clock.elapsedTime*(a%2?-.035:.028))})}),e.jsxs("group",{ref:o,position:[g,S(0),z],children:[e.jsxs("mesh",{children:[e.jsx("circleGeometry",{args:[x*.76,64]}),e.jsx("meshBasicMaterial",{color:"#e7fff4",transparent:!0,opacity:.9,toneMapped:!1})]}),e.jsxs("mesh",{children:[e.jsx("ringGeometry",{args:[x*.76,x*.82,64]}),e.jsx("meshBasicMaterial",{color:"#6ee7b7",transparent:!0,opacity:.82,toneMapped:!1})]}),[1,1.22,1.44].map((r,n)=>e.jsxs("mesh",{ref:a=>{t.current[n]=a},children:[e.jsx("torusGeometry",{args:[x*r,.026-n*.005,8,96]}),e.jsx("meshBasicMaterial",{color:n===1?"#6ee7b7":"#10b981",transparent:!0,opacity:.46-n*.09,toneMapped:!1})]},r)),s.map((r,n)=>e.jsxs("mesh",{position:[r.x*x*1.58,r.y*x*1.58,0],rotation:[0,0,r.angle-Math.PI/2],children:[e.jsx("boxGeometry",{args:[.055,r.major?.42:.2,.055]}),e.jsx("meshBasicMaterial",{color:"#a7f3d0",transparent:!0,opacity:r.major?.72:.36,toneMapped:!1})]},n))]})}function $(){const o=c.useMemo(()=>({uBeaconDir:{value:new M(0,.1,-1)},uBeaconColor:{value:new p(v.beacon)},uHorizon:{value:new p(v.horizon)}}),[]),t=c.useRef(null),{camera:s}=j(),r=c.useMemo(()=>new M,[]);return y(()=>{const n=r.set(g,S(u.smooth),z);o.uBeaconDir.value.copy(n).sub(s.position).normalize()}),e.jsxs("mesh",{rotation:[-Math.PI/2,0,0],position:[0,l,0],receiveShadow:!0,children:[e.jsx("planeGeometry",{args:[1400,1400]}),e.jsx("shaderMaterial",{ref:t,uniforms:o,vertexShader:`
          varying vec3 vWorld;
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorld = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,fragmentShader:`
          uniform vec3 uBeaconDir;
          uniform vec3 uBeaconColor;
          uniform vec3 uHorizon;
          varying vec3 vWorld;
          ${G}
          void main() {
            float dist = length(vWorld.xz - cameraPosition.xz);

            vec3 nearCol = vec3(0.0046, 0.0142, 0.0136);
            vec3 farCol  = vec3(0.0078, 0.0272, 0.0254);
            vec3 col = mix(nearCol, farCol, smoothstep(2.0, 90.0, dist));

            // drifting ground tone so the plain never reads as a flat fill
            float mottle = cineFbm(vec3(vWorld.xz * 0.055, 0.0));
            col *= 0.86 + mottle * 0.34;

            // quiet grazing light on the ridge line
            float ridge = (1.0 - smoothstep(16.0, 70.0, dist)) * 0.35;
            col += uBeaconColor * ridge * 0.018;

            // restrained ground wash beneath the beacon
            vec3 flatDir = normalize(vec3(uBeaconDir.x, 0.0, uBeaconDir.z));
            vec3 fromCam = normalize(vec3(vWorld.x - cameraPosition.x, 0.0, vWorld.z - cameraPosition.z));
            float alignBeacon = max(dot(fromCam, flatDir), 0.0);
            float smear = pow(alignBeacon, 26.0)
              * smoothstep(6.0, 26.0, dist)
              * (1.0 - smoothstep(60.0, 170.0, dist));
            col += uBeaconColor * smear * 0.12;

            // distance haze — the far plain must land exactly on the sky's
            // horizon colour, otherwise the plane's edge is a visible seam.
            float haze = smoothstep(30.0, 260.0, dist);
            col = mix(col, uHorizon * 0.86, haze);

            float n = fract(sin(dot(vWorld.xz, vec2(12.9898, 78.233))) * 43758.5453);
            col += (n - 0.5) * 0.005;

            gl_FragColor = vec4(col, 1.0);
          }
        `,toneMapped:!1})]})}const E={color:"#04100e",roughness:.96,metalness:0},K=`
  varying vec2 vUv;
  uniform float uHeight;
  uniform float uSeed;
  uniform float uBeaconUvX;
  uniform vec3 uShade;
  uniform vec3 uRim;
  ${G}

  void main() {
    // three octave bands of different width → broad hills, shoulders, texture
    float x = vUv.x * 3.1 + uSeed;
    float n  = cineFbm(vec3(x, uSeed, 0.0));
    float n2 = cineFbm(vec3(x * 2.9, uSeed + 5.0, 0.0));
    float n3 = cineFbm(vec3(vUv.x * 9.0 + uSeed, uSeed + 9.0, 0.0));
    float h = uHeight + (n - 0.5) * 0.300 + (n2 - 0.5) * 0.105 + (n3 - 0.5) * 0.030;

    float below = 1.0 - smoothstep(h - 0.0016, h + 0.0016, vUv.y);
    if (below < 0.01) discard;

    // body: slightly lifted near the crest, falling into the plain
    float depth = clamp((h - vUv.y) / 0.42, 0.0, 1.0);
    vec3 col = mix(uShade * 1.6, uShade * 0.7, depth);

    // mint rim only where the beacon is actually behind the crest
    float beaconProx = 1.0 - smoothstep(0.0, 0.26, abs(vUv.x - uBeaconUvX));
    float rim = (1.0 - smoothstep(0.0, 0.0030, abs(vUv.y - h))) * beaconProx;
    col = mix(col, uRim, rim * 0.4);

    gl_FragColor = vec4(col, below);
  }
`;function C({z:o,height:t,seed:s,shade:r,rim:n}){const a=c.useMemo(()=>({uHeight:{value:t},uSeed:{value:s},uBeaconUvX:{value:.5+g/220},uShade:{value:new p(r)},uRim:{value:new p(n)}}),[t,s,r,n]);return e.jsxs("mesh",{position:[0,10,o],children:[e.jsx("planeGeometry",{args:[220,60]}),e.jsx("shaderMaterial",{uniforms:a,vertexShader:`
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
        `,fragmentShader:K,transparent:!0,depthWrite:!1,toneMapped:!1})]})}function Z({position:o,scale:t=1,rotation:s=0}){return e.jsxs("group",{position:o,rotation:[0,s,0],scale:t,children:[e.jsxs("mesh",{children:[e.jsx("coneGeometry",{args:[1,1.2,4]}),e.jsx("meshStandardMaterial",{...E})]}),e.jsxs("mesh",{position:[0,.02,.44],rotation:[.05,0,0],children:[e.jsx("planeGeometry",{args:[.17,.34]}),e.jsx("meshBasicMaterial",{color:"#6ee7b7",transparent:!0,opacity:.34,toneMapped:!1})]}),e.jsxs("mesh",{position:[0,.66,0],children:[e.jsx("cylinderGeometry",{args:[.012,.012,.2,5]}),e.jsx("meshStandardMaterial",{color:"#0a1a16",roughness:.9})]})]})}function b({position:o,scale:t=1}){return e.jsxs("group",{position:o,scale:t,children:[e.jsxs("mesh",{position:[0,.9,0],children:[e.jsx("cylinderGeometry",{args:[.06,.09,1.8,6]}),e.jsx("meshStandardMaterial",{...E})]}),e.jsxs("mesh",{position:[0,2.2,0],children:[e.jsx("icosahedronGeometry",{args:[.78,1]}),e.jsx("meshStandardMaterial",{color:"#05130f",roughness:1,flatShading:!0})]}),e.jsxs("mesh",{position:[.42,1.75,.1],scale:.7,children:[e.jsx("icosahedronGeometry",{args:[.6,1]}),e.jsx("meshStandardMaterial",{color:"#06170f",roughness:1,flatShading:!0})]})]})}function B({position:o,scale:t=1}){return e.jsxs("group",{position:o,scale:t,children:[e.jsxs("mesh",{position:[0,.62,0],rotation:[0,Math.PI/4,0],scale:[1.7,1,1.25],children:[e.jsx("coneGeometry",{args:[1.4,.34,4]}),e.jsx("meshStandardMaterial",{color:"#071713",roughness:.85,flatShading:!0})]}),[[-.92,-.62],[.92,-.62],[-.92,.62],[.92,.62]].map(([s,r],n)=>e.jsxs("mesh",{position:[s,.16,r],children:[e.jsx("cylinderGeometry",{args:[.03,.035,.95,5]}),e.jsx("meshStandardMaterial",{color:"#0a201a",roughness:.9})]},n)),e.jsxs("mesh",{position:[0,.02,0],children:[e.jsx("boxGeometry",{args:[.9,.06,.4]}),e.jsx("meshStandardMaterial",{color:"#0a201a",roughness:.8})]}),e.jsxs("mesh",{position:[0,.44,.1],children:[e.jsx("sphereGeometry",{args:[.022,8,6]}),e.jsx("meshBasicMaterial",{color:"#a7f3d0",toneMapped:!1,transparent:!0,opacity:.72})]})]})}function J({position:o,scale:t=1}){return e.jsxs("group",{position:o,scale:t,children:[e.jsxs("mesh",{position:[0,.62,0],children:[e.jsx("capsuleGeometry",{args:[.075,.26,4,8]}),e.jsx("meshStandardMaterial",{color:"#07130f",roughness:1})]}),e.jsxs("mesh",{position:[0,.9,0],children:[e.jsx("sphereGeometry",{args:[.085,10,8]}),e.jsx("meshStandardMaterial",{color:"#08160f",roughness:1})]})]})}function Q(){const o=c.useMemo(()=>[{p:[-8.6,l+.72,-19.5],s:1.2,r:.24},{p:[-5.2,l+.62,-17.2],s:1,r:-.18},{p:[2.2,l+.64,-18.4],s:1.06,r:.32},{p:[11.8,l+.86,-14.5],s:1.7,r:-.24},{p:[15.6,l+.6,-19.2],s:.96,r:.3},{p:[18.8,l+.5,-20.4],s:.84,r:-.12}],[]);return e.jsxs("group",{children:[e.jsx(C,{z:-44,height:.41,seed:1.7,shade:"#07201b",rim:"#3f8d73"}),e.jsx(C,{z:-26.5,height:.377,seed:4.2,shade:"#030c0b",rim:"#6ee7b7"}),o.map((t,s)=>e.jsx(Z,{position:t.p,scale:t.s,rotation:t.r},s)),e.jsx(B,{position:[-1.1,l,-15.4],scale:1.05}),e.jsx(B,{position:[14.6,l,-15.6],scale:1}),e.jsx(B,{position:[7,l,-24],scale:.8}),e.jsx(b,{position:[-12.6,l,-21],scale:1.5}),e.jsx(b,{position:[18.2,l,-22.5],scale:1.25}),e.jsx(b,{position:[-10.4,l,-25],scale:1.1}),e.jsx(b,{position:[21.4,l,-26],scale:1.4}),[[-2.9,l,-15.1,.95],[-1.6,l,-15.7,1],[1.9,l,-15.4,.92],[3.2,l,-16,1.02],[-5.5,l,-17.6,.9]].map(([t,s,r,n],a)=>e.jsx(J,{position:[t,s,r],scale:n},a))]})}function q(){if(typeof document>"u")return null;const o=64,t=document.createElement("canvas");t.width=o,t.height=o;const s=t.getContext("2d"),r=s.createRadialGradient(o/2,o/2,0,o/2,o/2,o/2);r.addColorStop(0,"rgba(255,255,255,1)"),r.addColorStop(.35,"rgba(255,255,255,0.65)"),r.addColorStop(1,"rgba(255,255,255,0)"),s.fillStyle=r,s.fillRect(0,0,o,o);const n=new k(t);return n.needsUpdate=!0,n}function ee({count:o}){const t=c.useRef(null),s=c.useMemo(()=>q(),[]),r=c.useMemo(()=>{const n=new Float32Array(o*3);for(let a=0;a<o;a++)n[a*3]=(Math.random()-.5)*34,n[a*3+1]=Math.random()*12-3.5,n[a*3+2]=(Math.random()-.5)*26-4;return n},[o]);return y((n,a)=>{!t.current||u.reduced||(t.current.rotation.y+=a*.012,t.current.position.y=Math.sin(n.clock.elapsedTime*.12)*.18)}),e.jsxs("points",{ref:t,frustumCulled:!1,children:[e.jsx("bufferGeometry",{children:e.jsx("bufferAttribute",{attach:"attributes-position",count:o,itemSize:3,array:r})}),e.jsx("pointsMaterial",{size:.09,map:s||void 0,color:"#a7f3d0",transparent:!0,opacity:.34,depthWrite:!1,sizeAttenuation:!0,toneMapped:!1})]})}function oe({count:o}){const t=c.useMemo(()=>{const s=new Float32Array(o*3);for(let r=0;r<o;r++){const n=120+Math.random()*40,a=Math.random()*Math.PI*2,i=Math.random()*.42*Math.PI;s[r*3]=Math.sin(i)*Math.cos(a)*n,s[r*3+1]=Math.cos(i)*n*.9+10,s[r*3+2]=Math.sin(i)*Math.sin(a)*n}return s},[o]);return e.jsxs("points",{frustumCulled:!1,children:[e.jsx("bufferGeometry",{children:e.jsx("bufferAttribute",{attach:"attributes-position",count:o,itemSize:3,array:t})}),e.jsx("pointsMaterial",{size:.42,color:"#cfe9e2",transparent:!0,opacity:.5,depthWrite:!1,sizeAttenuation:!0,toneMapped:!1})]})}function te(){const{camera:o,size:t}=j(),s=c.useMemo(()=>new M(0,2.7,-22),[]),r=c.useRef(0),n=c.useRef(48);return y((a,i)=>{const d=Math.min(1,i*3.2);u.reduced?u.smooth=0:u.smooth+=(u.scroll-u.smooth)*d;const m=a.clock.elapsedTime,h=u.reduced,f=h?0:u.smooth,R=h?0:1,D=h?0:u.mx,P=h?0:u.my,w=t.width/Math.max(1,t.height)<1.05,H=w?4.2:0,W=w?58:48;r.current+=(H-r.current)*Math.min(1,i*2.2),n.current+=(W-n.current)*Math.min(1,i*2.2),Math.abs(o.fov-n.current)>.01&&(o.fov=n.current,o.updateProjectionMatrix());const A=r.current*.55+D*1.05,F=2.05+Math.sin(m*.16)*.06*R+P*.42+f*1.15,T=(w?13.4:11.2)-f*2.6;o.position.x+=(A-o.position.x)*d*.6,o.position.y+=(F-o.position.y)*d*.6,o.position.z+=(T-o.position.z)*d*.6,s.set(r.current,(w?.35:2.65)+f*1.6,-22),o.lookAt(s)}),null}function re(){const o=j(s=>s.gl),t=j(s=>s.setSize);return c.useEffect(()=>{const s=o.domElement,r=s.closest(".cine-stage")||s.parentElement;if(!r)return;const n=()=>{const i=r.clientWidth,d=r.clientHeight;if(!i||!d)return;const m=o.getPixelRatio();(s.width!==Math.round(i*m)||s.height!==Math.round(d*m))&&t(i,d)};n();const a=new ResizeObserver(n);return a.observe(r),window.addEventListener("orientationchange",n),()=>{a.disconnect(),window.removeEventListener("orientationchange",n)}},[o,t]),null}function se({quality:o}){const t=o==="low"?140:320,s=o==="low"?90:220;return e.jsxs(e.Fragment,{children:[e.jsx(re,{}),e.jsx(Y,{}),e.jsx(oe,{count:s}),e.jsx(V,{}),e.jsx("ambientLight",{intensity:.28,color:"#0d3b34"}),e.jsx("hemisphereLight",{args:["#123c3a","#030b09",.55]}),e.jsx("directionalLight",{position:[g,9,z+6],intensity:1.65,color:"#d1fae5"}),e.jsx("pointLight",{position:[g,2,-24],intensity:16,distance:46,decay:2,color:"#10b981"}),e.jsx($,{}),e.jsx(Q,{}),e.jsx(ee,{count:t}),e.jsx(te,{})]})}function le({className:o=""}){const[t,s]=c.useState(!1),[r,n]=c.useState(!1),a=c.useMemo(()=>{var h;if(typeof window>"u")return"high";const i=navigator.hardwareConcurrency||4,d=window.matchMedia("(max-width: 760px)").matches,m=(h=navigator.connection)==null?void 0:h.saveData;return i<=4||d||m?"low":"high"},[]);return c.useEffect(()=>{var m,h;const i=(m=window.matchMedia)==null?void 0:m.call(window,"(prefers-reduced-motion: reduce)");if(!i)return;const d=()=>{u.reduced=i.matches,n(i.matches)};return d(),(h=i.addEventListener)==null||h.call(i,"change",d),()=>{var f;return(f=i.removeEventListener)==null?void 0:f.call(i,"change",d)}},[]),t?e.jsx(_,{className:o}):e.jsx("div",{className:`cine-stage ${o}`,"aria-hidden":"true",children:e.jsx(ne,{onError:()=>s(!0),children:e.jsx(I,{dpr:[1,a==="low"||r?1.35:1.75],frameloop:r?"demand":"always",camera:{position:[0,2.05,11.2],fov:48,near:.1,far:500},gl:{antialias:!0,alpha:!1,powerPreference:"high-performance"},onCreated:({gl:i})=>{i.toneMapping=L,i.toneMappingExposure=1.02},style:{width:"100%",height:"100%"},children:e.jsx(se,{quality:a})})})})}class ne extends U.Component{constructor(t){super(t),this.state={crashed:!1}}static getDerivedStateFromError(){return{crashed:!0}}componentDidCatch(){var t,s;(s=(t=this.props).onError)==null||s.call(t)}render(){return this.state.crashed?null:this.props.children}}export{le as default};
