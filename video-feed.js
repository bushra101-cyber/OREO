/**
 * OREO - ESP32-CAM Tactical Video Stream & Computer Vision HUD Engine
 * Handles real-time canvas rendering of underground mining drift navigation,
 * multi-spectrum filters (Optical, Thermal FLIR, Night Vision),
 * and AI Computer Vision bounding box overlays.
 */

class TacticalVideoFeed {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    
    this.currentMode = 'optical'; // 'optical', 'thermal', 'night'
    this.headlightsOn = true;
    this.aiHudActive = true;
    this.isStreamActive = true;
    
    // Virtual drift & rover telemetry
    this.cameraPitch = 1.2;
    this.cameraRoll = -0.8;
    this.roverSpeed = 0.6; // Movement speed inside drift
    this.tunnelZ = 0; // Tunnel progression
    
    // Dynamic dust / particulate particles inside mine shaft
    this.dustParticles = [];
    this.initParticles(45);

    // Hazard visual state
    this.activeHazards = {
      gasLeak: false,
      flame: false,
      caveIn: false,
      survivor: true // miner hardhat detected
    };

    // Real ESP32-CAM stream image element (for hardware mode)
    this.realStreamImg = new Image();
    this.realStreamImg.crossOrigin = "anonymous";
    this.usingRealStream = false;

    this.initEventListeners();
    this.startRenderLoop();
  }

  initParticles(count) {
    for (let i = 0; i < count; i++) {
      this.dustParticles.push({
        x: Math.random() * this.canvas.width,
        y: Math.random() * this.canvas.height,
        z: Math.random() * 800 + 50,
        size: Math.random() * 2 + 0.8,
        speedX: (Math.random() - 0.5) * 0.4,
        speedY: (Math.random() - 0.5) * 0.3,
        opacity: Math.random() * 0.7 + 0.2
      });
    }
  }

  initEventListeners() {
    // Mode Buttons
    const modeButtons = document.querySelectorAll('.spectrum-btn');
    modeButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        modeButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentMode = btn.dataset.mode;
      });
    });

    // Toggle AI CV boxes
    const aiBtn = document.getElementById('toggle-ai-boxes-btn');
    if (aiBtn) {
      aiBtn.addEventListener('click', () => {
        this.aiHudActive = !this.aiHudActive;
        aiBtn.classList.toggle('active', this.aiHudActive);
      });
    }

    // Toggle Headlights
    const lightBtn = document.getElementById('toggle-headlight-btn');
    if (lightBtn) {
      lightBtn.addEventListener('click', () => {
        this.headlightsOn = !this.headlightsOn;
        lightBtn.classList.toggle('active', this.headlightsOn);
        const luxLabel = document.getElementById('hud-lux');
        if (luxLabel) {
          luxLabel.innerText = this.headlightsOn ? 'LUX: 38.5 (HEADLIGHT)' : 'LUX: 0.8 (EXTREME LOW)';
        }
      });
    }

    // Snapshot button
    const snapBtn = document.getElementById('snapshot-btn');
    if (snapBtn) {
      snapBtn.addEventListener('click', () => {
        this.captureSnapshot();
      });
    }
  }

  setHazardStates(states) {
    this.activeHazards = { ...this.activeHazards, ...states };
  }

  captureSnapshot() {
    const link = document.createElement('a');
    link.download = `OREO_CAM_SNAP_${Date.now()}.png`;
    link.href = this.canvas.toDataURL('image/png');
    link.click();
  }

  updateAttitude(pitch, roll) {
    this.cameraPitch = pitch;
    this.cameraRoll = roll;
    
    // Update DOM Artificial Horizon indicator
    const horizonEl = document.getElementById('artificial-horizon');
    const readoutEl = document.getElementById('attitude-readout');
    if (horizonEl) {
      horizonEl.style.transform = `translate(-50%, -50%) rotate(${roll}deg) translateY(${pitch * 2}px)`;
    }
    if (readoutEl) {
      readoutEl.innerText = `PITCH: ${pitch >= 0 ? '+' : ''}${pitch.toFixed(1)}° • ROLL: ${roll >= 0 ? '+' : ''}${roll.toFixed(1)}°`;
    }
  }

  startRenderLoop() {
    const render = () => {
      if (this.isStreamActive) {
        this.renderFrame();
      }
      requestAnimationFrame(render);
    };
    requestAnimationFrame(render);
  }

  renderFrame() {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;

    // Advance tunnel perspective progression
    this.tunnelZ = (this.tunnelZ + this.roverSpeed) % 100;

    // 1. Draw base tunnel environment
    this.drawMineDriftEnvironment(ctx, w, h);

    // 2. Draw particulate dust motes
    this.drawParticulates(ctx, w, h);

    // 3. Draw hazard elements inside tunnel (Fire, Gas pocket, Cave-in obstacle)
    this.drawTunnelHazards(ctx, w, h);

    // 4. Apply Multi-Spectrum Vision Shader
    if (this.currentMode === 'thermal') {
      this.applyThermalFilter(ctx, w, h);
    } else if (this.currentMode === 'night') {
      this.applyNightVisionFilter(ctx, w, h);
    }

    // 5. Draw Headlight Radial Lighting Beam
    this.drawHeadlightBeam(ctx, w, h);

    // 6. Draw AI Computer Vision Bounding Boxes (if enabled)
    if (this.aiHudActive) {
      this.drawAIBoundingBoxes(ctx, w, h);
    }

    // 7. Video Scanline Overlay
    this.drawScanlines(ctx, w, h);
  }

  drawMineDriftEnvironment(ctx, w, h) {
    // Pitch-black mine background
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2 - this.cameraPitch * 3;

    // Dynamic vanishing point perspective
    const arches = 6;
    for (let i = arches; i >= 1; i--) {
      const depth = (i * 80 - (this.tunnelZ * 0.8) % 80) / 480; // 0 to 1
      if (depth <= 0) continue;

      const archW = (1 - depth) * w * 1.1;
      const archH = (1 - depth) * h * 0.95;
      const left = cx - archW / 2;
      const top = cy - archH / 2;

      // Steel mine rib / rock wall arch
      ctx.strokeStyle = `rgba(100, 116, 139, ${0.15 + (1 - depth) * 0.5})`;
      ctx.lineWidth = Math.max(1, (1 - depth) * 4);
      
      ctx.beginPath();
      // Curved mining timber / steel arch support
      ctx.moveTo(left, top + archH);
      ctx.lineTo(left, top + archH * 0.3);
      ctx.bezierCurveTo(left, top, left + archW, top, left + archW, top + archH * 0.3);
      ctx.lineTo(left + archW, top + archH);
      ctx.stroke();

      // Rock wall contour shading
      ctx.fillStyle = `rgba(15, 23, 42, ${(1 - depth) * 0.25})`;
      ctx.fill();
    }

    // Mine Floor Rail Tracks
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
    ctx.lineWidth = 2;
    
    // Left Rail
    ctx.beginPath();
    ctx.moveTo(cx - 30, cy + 30);
    ctx.lineTo(cx - 180, h);
    ctx.stroke();

    // Right Rail
    ctx.beginPath();
    ctx.moveTo(cx + 30, cy + 30);
    ctx.lineTo(cx + 180, h);
    ctx.stroke();

    // Railway Sleepers (Ties)
    ctx.strokeStyle = 'rgba(71, 85, 105, 0.35)';
    ctx.lineWidth = 3;
    for (let t = 0; t < 8; t++) {
      const progress = ((t * 20 + this.tunnelZ * 1.2) % 160) / 160;
      const y = cy + 30 + progress * (h - (cy + 30));
      const tieW = 60 + progress * 240;
      ctx.beginPath();
      ctx.moveTo(cx - tieW / 2, y);
      ctx.lineTo(cx + tieW / 2, y);
      ctx.stroke();
    }
  }

  drawParticulates(ctx, w, h) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    for (let p of this.dustParticles) {
      p.x += p.speedX;
      p.y += p.speedY;
      p.z -= this.roverSpeed * 2;

      if (p.z <= 10) {
        p.z = 800;
        p.x = Math.random() * w;
        p.y = Math.random() * h;
      }
      if (p.x < 0) p.x = w;
      if (p.x > w) p.x = 0;
      if (p.y < 0) p.y = h;
      if (p.y > h) p.y = 0;

      const scale = 200 / p.z;
      const px = (p.x - w / 2) * scale + w / 2;
      const py = (p.y - h / 2) * scale + h / 2;
      const radius = Math.max(0.6, p.size * scale);

      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${p.opacity * Math.min(1, scale * 1.5)})`;
      ctx.fill();
    }
  }

  drawTunnelHazards(ctx, w, h) {
    const cx = w / 2;
    const cy = h / 2;

    // 1. Gas Leak Methane Cloud Hazard (if active)
    if (this.activeHazards.gasLeak) {
      const gasX = cx + 80;
      const gasY = cy - 20;
      const gasGrad = ctx.createRadialGradient(gasX, gasY, 10, gasX, gasY, 90);
      gasGrad.addColorStop(0, 'rgba(0, 240, 255, 0.45)');
      gasGrad.addColorStop(0.5, 'rgba(0, 255, 136, 0.2)');
      gasGrad.addColorStop(1, 'transparent');

      ctx.fillStyle = gasGrad;
      ctx.beginPath();
      ctx.arc(gasX, gasY, 90, 0, Math.PI * 2);
      ctx.fill();
    }

    // 2. Open Mine Fire / Flame Hazard (if active)
    if (this.activeHazards.flame) {
      const fireX = cx - 120;
      const fireY = cy + 40;
      
      // Flickering flame glow
      const flicker = Math.sin(Date.now() * 0.02) * 8;
      const fireGrad = ctx.createRadialGradient(fireX, fireY, 5, fireX, fireY, 65 + flicker);
      fireGrad.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
      fireGrad.addColorStop(0.25, 'rgba(255, 200, 0, 0.8)');
      fireGrad.addColorStop(0.6, 'rgba(255, 50, 0, 0.6)');
      fireGrad.addColorStop(1, 'transparent');

      ctx.fillStyle = fireGrad;
      ctx.beginPath();
      ctx.arc(fireX, fireY, 65 + flicker, 0, Math.PI * 2);
      ctx.fill();

      // Flame core tongue
      ctx.fillStyle = '#ffeedd';
      ctx.beginPath();
      ctx.moveTo(fireX - 12, fireY + 20);
      ctx.quadraticCurveTo(fireX, fireY - 35 + flicker, fireX + 12, fireY + 20);
      ctx.fill();
    }

    // 3. Cave-In / Rockfall Obstacle (if active)
    if (this.activeHazards.caveIn) {
      ctx.fillStyle = '#334155';
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 2;
      
      // Pile of jagged boulders across the tracks
      ctx.beginPath();
      ctx.moveTo(cx - 70, cy + 85);
      ctx.lineTo(cx - 30, cy + 35);
      ctx.lineTo(cx + 10, cy + 50);
      ctx.lineTo(cx + 60, cy + 30);
      ctx.lineTo(cx + 95, cy + 90);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // 4. Miner Hardhat silhouette (Survivor safe indicator)
    if (this.activeHazards.survivor && !this.activeHazards.caveIn) {
      const survX = cx + 110;
      const survY = cy + 30;
      
      // Safety yellow hardhat
      ctx.fillStyle = '#eab308';
      ctx.beginPath();
      ctx.arc(survX, survY, 14, Math.PI, 0);
      ctx.fill();
      // Brim
      ctx.fillRect(survX - 18, survY, 36, 4);
      // Hardhat lamp
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(survX, survY - 8, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawHeadlightBeam(ctx, w, h) {
    if (!this.headlightsOn) {
      // Near total darkness vignette
      ctx.fillStyle = 'rgba(4, 6, 10, 0.88)';
      ctx.fillRect(0, 0, w, h);
      return;
    }

    // Radial headlight spotlight beam cast on the rock drift
    const cx = w / 2;
    const cy = h / 2 - this.cameraPitch * 2;
    const beamGrad = ctx.createRadialGradient(cx, cy, 40, cx, cy, w * 0.65);
    beamGrad.addColorStop(0, 'rgba(255, 255, 255, 0.05)');
    beamGrad.addColorStop(0.5, 'rgba(200, 225, 255, 0.02)');
    beamGrad.addColorStop(0.85, 'rgba(5, 7, 12, 0.7)');
    beamGrad.addColorStop(1, 'rgba(4, 6, 10, 0.95)');

    ctx.fillStyle = beamGrad;
    ctx.fillRect(0, 0, w, h);
  }

  applyThermalFilter(ctx, w, h) {
    // Thermal FLIR infrared False-Color wash
    ctx.save();
    ctx.globalCompositeOperation = 'color-burn';
    ctx.fillStyle = 'rgba(76, 29, 149, 0.65)'; // deep indigo base
    ctx.fillRect(0, 0, w, h);

    ctx.globalCompositeOperation = 'screen';
    // Heat signatures in ironbow
    const heatGrad = ctx.createLinearGradient(0, 0, w, h);
    heatGrad.addColorStop(0, 'rgba(234, 88, 12, 0.35)');
    heatGrad.addColorStop(0.5, 'rgba(245, 158, 11, 0.25)');
    heatGrad.addColorStop(1, 'rgba(124, 58, 237, 0.35)');
    ctx.fillStyle = heatGrad;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  applyNightVisionFilter(ctx, w, h) {
    // Phosphor Green monochromatic Night Vision
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = '#10b981';
    ctx.fillRect(0, 0, w, h);

    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = 'rgba(16, 185, 129, 0.25)';
    ctx.fillRect(0, 0, w, h);

    // High gain sensor noise
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    for (let i = 0; i < 200; i++) {
      const rx = Math.random() * w;
      const ry = Math.random() * h;
      ctx.fillRect(rx, ry, 2, 2);
    }
    ctx.restore();
  }

  drawAIBoundingBoxes(ctx, w, h) {
    const cx = w / 2;
    const cy = h / 2;

    ctx.font = 'bold 10px "JetBrains Mono", monospace';
    ctx.lineWidth = 1.5;

    // Bounding Box 1: Survivor / Miner Hardhat (if present)
    if (this.activeHazards.survivor && !this.activeHazards.caveIn) {
      const bx = cx + 80;
      const by = cy + 10;
      const bw = 60;
      const bh = 55;

      ctx.strokeStyle = '#00ff88';
      ctx.fillStyle = 'rgba(0, 255, 136, 0.12)';
      ctx.strokeRect(bx, by, bw, bh);
      ctx.fillRect(bx, by, bw, bh);

      // Corner markers
      this.drawCornerBrackets(ctx, bx, by, bw, bh, '#00ff88');

      // Tag Label
      ctx.fillStyle = '#00ff88';
      ctx.fillRect(bx, by - 16, bw + 35, 15);
      ctx.fillStyle = '#07090e';
      ctx.fillText('SURVIVOR [98%]', bx + 3, by - 4);
    }

    // Bounding Box 2: Methane Gas Leak
    if (this.activeHazards.gasLeak) {
      const bx = cx + 50;
      const by = cy - 50;
      const bw = 110;
      const bh = 80;

      ctx.strokeStyle = '#ffb800';
      ctx.fillStyle = 'rgba(255, 184, 0, 0.15)';
      ctx.strokeRect(bx, by, bw, bh);
      ctx.fillRect(bx, by, bw, bh);
      this.drawCornerBrackets(ctx, bx, by, bw, bh, '#ffb800');

      ctx.fillStyle = '#ffb800';
      ctx.fillRect(bx, by - 16, bw + 20, 15);
      ctx.fillStyle = '#07090e';
      ctx.fillText('GAS POCKET 520PPM', bx + 3, by - 4);
    }

    // Bounding Box 3: Open Fire
    if (this.activeHazards.flame) {
      const bx = cx - 150;
      const by = cy + 10;
      const bw = 90;
      const bh = 75;

      ctx.strokeStyle = '#ff2a5f';
      ctx.fillStyle = 'rgba(255, 42, 95, 0.2)';
      ctx.strokeRect(bx, by, bw, bh);
      ctx.fillRect(bx, by, bw, bh);
      this.drawCornerBrackets(ctx, bx, by, bw, bh, '#ff2a5f');

      ctx.fillStyle = '#ff2a5f';
      ctx.fillRect(bx, by - 16, bw + 20, 15);
      ctx.fillStyle = '#ffffff';
      ctx.fillText('CRITICAL FLAME [99%]', bx + 3, by - 4);
    }

    // Bounding Box 4: Cave-In Obstacle
    if (this.activeHazards.caveIn) {
      const bx = cx - 80;
      const by = cy + 25;
      const bw = 175;
      const bh = 75;

      ctx.strokeStyle = '#ff2a5f';
      ctx.fillStyle = 'rgba(255, 42, 95, 0.18)';
      ctx.strokeRect(bx, by, bw, bh);
      ctx.fillRect(bx, by, bw, bh);
      this.drawCornerBrackets(ctx, bx, by, bw, bh, '#ff2a5f');

      ctx.fillStyle = '#ff2a5f';
      ctx.fillRect(bx, by - 16, bw, 15);
      ctx.fillStyle = '#ffffff';
      ctx.fillText('OBSTACLE: COLLAPSE 0.38m', bx + 3, by - 4);
    }
  }

  drawCornerBrackets(ctx, x, y, w, h, color) {
    const len = 8;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;

    // Top-Left
    ctx.beginPath();
    ctx.moveTo(x, y + len);
    ctx.lineTo(x, y);
    ctx.lineTo(x + len, y);
    ctx.stroke();

    // Top-Right
    ctx.beginPath();
    ctx.moveTo(x + w - len, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + len);
    ctx.stroke();

    // Bottom-Left
    ctx.beginPath();
    ctx.moveTo(x, y + h - len);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x + len, y + h);
    ctx.stroke();

    // Bottom-Right
    ctx.beginPath();
    ctx.moveTo(x + w - len, y + h);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + w, y + h - len);
    ctx.stroke();
  }

  drawScanlines(ctx, w, h) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    for (let y = 0; y < h; y += 3) {
      ctx.fillRect(0, y, w, 1);
    }
  }
}

// Export instance
window.TacticalVideoFeed = TacticalVideoFeed;
