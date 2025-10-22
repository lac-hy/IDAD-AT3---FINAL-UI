// mixer.js — safe tap (no disconnects). Adds wet/dry FX and UI control.
// Works even if your engine graph differs. If a compressor exists, we tap after it;
// otherwise we tap after master. We leave your original path untouched, so there is no silence.

(() => {
  const $  = s => document.querySelector(s);
  const qa = s => Array.from(document.querySelectorAll(s));

  // UI
  const wet = $("#mxWet"), dry = $("#mxDry"), gain = $("#mxGain");
  const macros = qa(".knob[data-macro]");
  const presetSel = $("#mxPreset"), saveBtn = $("#mxSave");
  const sampleOut = $("#mxSample");
  const art = $("#mxArt");

  // cosmetic sweep for knobs
  function bindKnob(el){ if(!el) return; const apply = () => el.style.setProperty("--val", el.value); el.addEventListener("input", apply); apply(); }
  [wet, dry, gain, ...macros].forEach(bindKnob);

  function attach(){
    const tap = window.__AUDIO_TAP__;
    if(!tap || !tap.ctx || !tap.master) return false;

    const ctx = tap.ctx;
    sampleOut && (sampleOut.textContent = ctx.sampleRate);

    // choose a safe post-mix node to tap
    const postNode = tap.comp || tap.compressor || tap.post || tap.master;

    // ---- Build an entirely parallel wet/dry chain (no disconnects) ----
    const splitter = ctx.createGain();               // a tee for our chain
    postNode.connect(splitter);                      // tap the existing path without altering it

    const dryBus = ctx.createGain();                 // dry feed
    const wetBus = ctx.createGain();                 // wet feed
    const out    = ctx.createGain();                 // our mixer output

    // FX: filter -> crusher -> delay (+ feedback)
    const filter = ctx.createBiquadFilter(); filter.type = "lowpass"; filter.frequency.value = 16000;
    const crusher = ctx.createWaveShaper();
    const tbl = new Float32Array(65536);
    for(let i=0;i<tbl.length;i++){ const x=(i/32768)-1; tbl[i]=Math.round(x*16)/16; }
    crusher.curve = tbl; crusher.oversample = "4x";
    const delay = ctx.createDelay(1.0); delay.delayTime.value = 0.12;
    const fb = ctx.createGain(); fb.gain.value = 0.18;

    // route
    splitter.connect(dryBus).connect(out);
    splitter.connect(wetBus).connect(filter).connect(crusher).connect(delay).connect(out);
    delay.connect(fb).connect(delay);

    // final: send our mix to destination (parallel with your original graph)
    out.connect(ctx.destination);

    // controls
    const setWet  = v => wetBus.gain.setTargetAtTime(v, ctx.currentTime, .01);
    const setDry  = v => dryBus.gain.setTargetAtTime(v, ctx.currentTime, .01);
    const setGain = v => out.gain.setTargetAtTime(v,  ctx.currentTime, .01);

    setWet(wet ? wet.value/100 : .5);
    setDry(dry ? dry.value/100 : .5);
    setGain(gain ? Math.pow(gain.value/100, 1.2) : .9);

    wet  && wet.addEventListener("input", () => setWet(wet.value/100));
    dry  && dry.addEventListener("input", () => setDry(dry.value/100));
    gain && gain.addEventListener("input", () => setGain(Math.pow(gain.value/100,1.2)));

    function applyMacros(){
      const A = macros[0] ? macros[0].value/100 : .25;  // filter cutoff
      const B = macros[1] ? macros[1].value/100 : .25;  // delay time
      const C = macros[2] ? macros[2].value/100 : .25;  // feedback
      const D = macros[3] ? macros[3].value/100 : .10;  // crush amount
      filter.frequency.setTargetAtTime(400 + A*18000, ctx.currentTime, .05);
      delay.delayTime.setTargetAtTime(0.02 + B*0.48, ctx.currentTime, .05);
      fb.gain.setTargetAtTime(C*0.6, ctx.currentTime, .05);
      crusher.oversample = (D>0.7) ? "none" : (D>0.35 ? "2x" : "4x");
    }
    macros.forEach(k => k && k.addEventListener("input", applyMacros));
    applyMacros();

    // Presets
    const KEY = "mx-presets-v1";
    function loadPresets(){
      const list = JSON.parse(localStorage.getItem(KEY) || "[]");
      if(presetSel){
        presetSel.innerHTML = `<option>New Preset</option>` + list.map(p => `<option value="${p.id}">${p.name}</option>`).join("");
      }
      return list;
    }
    function state(name="New Preset"){
      return { id: crypto.randomUUID(), name,
        wet: wet?.value, dry: dry?.value, gain: gain?.value,
        A: macros[0]?.value, B: macros[1]?.value, C: macros[2]?.value, D: macros[3]?.value
      };
    }
    function applyPreset(p){
      if(!p) return;
      if(wet) wet.value=p.wet; if(dry) dry.value=p.dry; if(gain) gain.value=p.gain;
      macros[0] && (macros[0].value=p.A); macros[1] && (macros[1].value=p.B);
      macros[2] && (macros[2].value=p.C); macros[3] && (macros[3].value=p.D);
      [wet,dry,gain,...macros].forEach(el => el && el.dispatchEvent(new Event("input")));
    }
    loadPresets();
    saveBtn && saveBtn.addEventListener("click", () => {
      const name = prompt("Preset name?"); if(!name) return;
      const all = loadPresets(); all.push(state(name));
      localStorage.setItem(KEY, JSON.stringify(all)); loadPresets();
    });
    presetSel && presetSel.addEventListener("change", () => {
      const all = JSON.parse(localStorage.getItem(KEY) || "[]");
      applyPreset(all.find(x => x.id === presetSel.value));
    });

    // gradient art
    const ctx2d = art?.getContext("2d");
    function drawArt(){
      if(!ctx2d || !art) return;
      const w = art.width = art.clientWidth, h = art.height = art.clientHeight;
      const g1 = ctx2d.createRadialGradient(w*.72,h*.28,20, w*.7,h*.3, Math.max(w,h)*.8);
      g1.addColorStop(0,"#ff8a00"); g1.addColorStop(.45,"#ff8a00"); g1.addColorStop(.60,"#914000");
      g1.addColorStop(.72,"#3b0f10"); g1.addColorStop(.86,"#1f0b15"); g1.addColorStop(1,"#120913");
      ctx2d.fillStyle=g1; ctx2d.fillRect(0,0,w,h);
      const g2 = ctx2d.createRadialGradient(w*.35,h*.85,10, w*.35,h*.85, Math.max(w,h)*.7);
      g2.addColorStop(0,"rgba(205,95,255,.55)"); g2.addColorStop(1,"rgba(205,95,255,0)");
      ctx2d.globalCompositeOperation="screen"; ctx2d.fillStyle=g2; ctx2d.fillRect(0,0,w,h);
      ctx2d.globalCompositeOperation="source-over";
    }
    if(art){ new ResizeObserver(drawArt).observe(art); drawArt(); }

    // Ensure audio resumes on any user gesture
    const resume = () => { if(ctx.state === "suspended") ctx.resume(); };
    window.addEventListener("pointerdown", resume, { passive:true });
    window.addEventListener("keydown", resume, { passive:true });

    return true;
  }

  // Try now, then keep trying briefly until your engine is ready
  if(!attach()){
    let tries = 0;
    const iv = setInterval(() => { if(attach() || ++tries > 50) clearInterval(iv); }, 200);
  }
})();
