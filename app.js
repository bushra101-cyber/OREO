/**
 * OREO - Master Dashboard Application Orchestrator
 * Integrates:
 * - Real-time Multi-sensor telemetry & sparklines
 * - Physical I2C 16x2 LCD Mirror & Annunciator LEDs
 * - Tactical Web Audio Synthesizer (Mine evacuation sirens & alarms)
 * - Rover Drive Teleoperation (Keyboard WASD + Virtual D-pad + Throttle)
 * - Battery & Power Health tracking
 * - Emergency Evacuation safety sequence
 * - Hazard injection testing rig
 * - ESP32 Wi-Fi hardware bridge
 */

class OreoDashboardApp {
  constructor() {
    // Subsystems
    this.videoFeed = null;
    this.aiEngine = null;
    this.hoistController = null;
    this.audioSynth = new TacticalAudioSynthesizer();

    // System States
    this.isRoverRunning = true;
    this.driveState = 'PATROLLING'; // 'PATROLLING', 'HALTED', 'MANUAL_TELEOP', 'EMERGENCY_STOP'
    this.currentThrottle = 65; // PWM %
    this.autoObstacleGuard = true;
    this.audioMuted = false;
    this.isEmergencyActive = false;
    this.safetyCoverOpen = false;
    
    // Telemetry Sensor State
    this.sensorData = {
      gas: 142,        // MQ-5 PPM
      smoke: 28,       // Smoke PPM
      flame: 0,        // IR Flame Analog (0 = none, >350 = flame)
      vibration: 0.04, // SW-420 g-force
      distance: 142,   // HC-SR04 cm
      temp: 24.6,      // °C
      humidity: 68,    // % RH
      battery: 84,     // %
      batteryVolt: 8.24,
      currentDraw: 1.48
    };

    // Sensor History Buffers for Sparklines (last 25 points)
    this.history = {
      gas: Array(25).fill(142),
      smoke: Array(25).fill(28),
      flame: Array(25).fill(0),
      vibration: Array(25).fill(0.04),
      distance: Array(25).fill(142),
      temp: Array(25).fill(24.6)
    };

    // LCD alternating line ticker
    this.lcdCycle = 0;

    // Mission timer
    this.missionSeconds = 1458; // 00:24:18

    // Hardware bridge configuration
    this.mode = 'SIMULATION'; // 'SIMULATION' or 'ESP32_LIVE'
    this.esp32Ip = '192.168.4.1';
    this.pollingHz = 5;

    this.initSubsystems();
    this.initDOMListeners();
    this.initKeyboardControls();
    this.startMainLoops();
  }

  initSubsystems() {
    if (window.TacticalVideoFeed) {
      this.videoFeed = new window.TacticalVideoFeed('tactical-canvas');
    }
    if (window.AIMLHazardEngine) {
      this.aiEngine = new window.AIMLHazardEngine();
    }
    if (window.RescueHoistController) {
      this.hoistController = new window.RescueHoistController();
    }
  }

  initDOMListeners() {
    // 1. Rover Master Start / Stop Buttons
    const startBtn = document.getElementById('rover-start-btn');
    const stopBtn = document.getElementById('rover-stop-btn');
    
    if (startBtn && stopBtn) {
      startBtn.addEventListener('click', () => {
        this.isRoverRunning = true;
        this.driveState = 'PATROLLING';
        startBtn.classList.add('active');
        stopBtn.classList.remove('active');
        this.updateDriveStateDisplay();
        if (this.videoFeed) this.videoFeed.roverSpeed = (this.currentThrottle / 100) * 1.0;
        this.audioSynth.playClickSound();
      });

      stopBtn.addEventListener('click', () => {
        this.isRoverRunning = false;
        this.driveState = 'HALTED';
        stopBtn.classList.add('active');
        startBtn.classList.remove('active');
        this.updateDriveStateDisplay();
        if (this.videoFeed) this.videoFeed.roverSpeed = 0;
        this.audioSynth.playClickSound();
      });
    }

    // 2. Obstacle Guard Toggle
    const autoNavToggle = document.getElementById('auto-nav-toggle');
    if (autoNavToggle) {
      autoNavToggle.addEventListener('change', (e) => {
        this.autoObstacleGuard = e.target.checked;
      });
    }

    // 3. Speed Throttle & Gears
    const throttleSlider = document.getElementById('throttle-slider');
    const throttleValText = document.getElementById('throttle-value-text');
    if (throttleSlider && throttleValText) {
      throttleSlider.addEventListener('input', (e) => {
        this.currentThrottle = parseInt(e.target.value);
        throttleValText.innerText = `${this.currentThrottle}% PWM`;
        if (this.isRoverRunning && this.videoFeed) {
          this.videoFeed.roverSpeed = (this.currentThrottle / 100) * 1.0;
        }
      });
    }

    const gearButtons = document.querySelectorAll('.gear-btn');
    gearButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        gearButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const gear = parseInt(btn.dataset.gear);
        const pwm = gear === 1 ? 35 : gear === 2 ? 65 : 95;
        this.currentThrottle = pwm;
        if (throttleSlider) throttleSlider.value = pwm;
        if (throttleValText) throttleValText.innerText = `${pwm}% PWM`;
        if (this.isRoverRunning && this.videoFeed) {
          this.videoFeed.roverSpeed = (pwm / 100) * 1.0;
        }
        this.audioSynth.playClickSound();
      });
    });

    // 4. Virtual D-Pad Teleoperation
    const dpadButtons = document.querySelectorAll('.dpad-btn');
    dpadButtons.forEach(btn => {
      const dir = btn.dataset.dir;
      btn.addEventListener('mousedown', () => this.handleTeleopCommand(dir));
      btn.addEventListener('mouseup', () => this.releaseTeleopCommand(dir));
      btn.addEventListener('touchstart', (e) => { e.preventDefault(); this.handleTeleopCommand(dir); });
      btn.addEventListener('touchend', (e) => { e.preventDefault(); this.releaseTeleopCommand(dir); });
    });

    // 5. Emergency Evacuation Safety Cover & Trigger
    const safetyCover = document.getElementById('safety-cover');
    const evacBtn = document.getElementById('emergency-evac-btn');
    const resetEvacBtn = document.getElementById('reset-evac-btn');

    if (safetyCover && evacBtn) {
      safetyCover.addEventListener('click', () => {
        this.safetyCoverOpen = true;
        safetyCover.classList.add('flipped');
        evacBtn.removeAttribute('disabled');
        const coverLockIcon = document.getElementById('cover-lock-icon');
        if (coverLockIcon) coverLockIcon.innerText = '🔓';
        this.audioSynth.playArmSound();
      });

      evacBtn.addEventListener('click', () => {
        this.triggerEmergencyEvacuation();
      });
    }

    if (resetEvacBtn) {
      resetEvacBtn.addEventListener('click', () => {
        this.resetEmergencyEvacuation();
      });
    }

    // 6. Tactical Audio Alarm Toggle
    const audioBtn = document.getElementById('audio-toggle-btn');
    const audioStatusText = document.getElementById('audio-status-text');
    const audioIcon = document.getElementById('audio-icon');
    if (audioBtn) {
      audioBtn.addEventListener('click', () => {
        this.audioMuted = !this.audioMuted;
        this.audioSynth.setMuted(this.audioMuted);
        if (this.audioMuted) {
          audioBtn.classList.add('muted');
          if (audioStatusText) audioStatusText.innerText = 'SIREN OFF';
          if (audioIcon) audioIcon.innerText = '🔇';
        } else {
          audioBtn.classList.remove('muted');
          if (audioStatusText) audioStatusText.innerText = 'SIREN ON';
          if (audioIcon) audioIcon.innerText = '🔊';
        }
      });
    }

    // 7. Simulation vs Hardware Mode Toggle
    const simBtn = document.getElementById('sim-mode-btn');
    const hwBtn = document.getElementById('hw-mode-btn');
    if (simBtn && hwBtn) {
      simBtn.addEventListener('click', () => {
        this.mode = 'SIMULATION';
        simBtn.classList.add('active');
        hwBtn.classList.remove('active');
        this.updateSystemStatusChip(true, 'SYSTEM ONLINE (SIM)');
      });
      hwBtn.addEventListener('click', () => {
        this.mode = 'ESP32_LIVE';
        hwBtn.classList.add('active');
        simBtn.classList.remove('active');
        this.openSettingsModal();
      });
    }

    // 8. Settings Modal
    const configBtn = document.getElementById('settings-modal-btn');
    const modal = document.getElementById('settings-modal');
    const closeModalBtn = document.getElementById('close-settings-btn');
    const cancelModalBtn = document.getElementById('cancel-settings-btn');
    const saveModalBtn = document.getElementById('save-connect-btn');

    if (configBtn && modal) {
      configBtn.addEventListener('click', () => this.openSettingsModal());
      if (closeModalBtn) closeModalBtn.addEventListener('click', () => modal.classList.add('hidden'));
      if (cancelModalBtn) cancelModalBtn.addEventListener('click', () => modal.classList.add('hidden'));
      if (saveModalBtn) {
        saveModalBtn.addEventListener('click', () => {
          const ipInput = document.getElementById('esp32-ip-input');
          if (ipInput) this.esp32Ip = ipInput.value;
          modal.classList.add('hidden');
          this.testEsp32Connection();
        });
      }
    }

    // 9. Hazard Demonstration / Testing Rig
    const scenarioButtons = document.querySelectorAll('.scenario-btn');
    scenarioButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const scenario = btn.dataset.scenario;
        this.injectHazardScenario(scenario);
        this.audioSynth.playClickSound();
      });
    });
  }

  initKeyboardControls() {
    window.addEventListener('keydown', (e) => {
      // Don't capture when typing in text inputs
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

      const key = e.key.toUpperCase();
      let dpadId = null;

      if (key === 'W' || key === 'ARROWUP') {
        this.handleTeleopCommand('FORWARD');
        dpadId = 'dpad-up';
      } else if (key === 'S' || key === 'ARROWDOWN') {
        this.handleTeleopCommand('REVERSE');
        dpadId = 'dpad-down';
      } else if (key === 'A' || key === 'ARROWLEFT') {
        this.handleTeleopCommand('LEFT');
        dpadId = 'dpad-left';
      } else if (key === 'D' || key === 'ARROWRIGHT') {
        this.handleTeleopCommand('RIGHT');
        dpadId = 'dpad-right';
      } else if (key === ' ' || key === 'SPACEBAR') {
        e.preventDefault();
        this.handleTeleopCommand('BRAKE');
        dpadId = 'dpad-brake';
      }

      if (dpadId) {
        const btn = document.getElementById(dpadId);
        if (btn) btn.classList.add('pressed');
      }
    });

    window.addEventListener('keyup', (e) => {
      const key = e.key.toUpperCase();
      let dpadId = null;

      if (key === 'W' || key === 'ARROWUP') {
        this.releaseTeleopCommand('FORWARD');
        dpadId = 'dpad-up';
      } else if (key === 'S' || key === 'ARROWDOWN') {
        this.releaseTeleopCommand('REVERSE');
        dpadId = 'dpad-down';
      } else if (key === 'A' || key === 'ARROWLEFT') {
        this.releaseTeleopCommand('LEFT');
        dpadId = 'dpad-left';
      } else if (key === 'D' || key === 'ARROWRIGHT') {
        this.releaseTeleopCommand('RIGHT');
        dpadId = 'dpad-right';
      } else if (key === ' ' || key === 'SPACEBAR') {
        this.releaseTeleopCommand('BRAKE');
        dpadId = 'dpad-brake';
      }

      if (dpadId) {
        const btn = document.getElementById(dpadId);
        if (btn) btn.classList.remove('pressed');
      }
    });
  }

  handleTeleopCommand(cmd) {
    if (!this.isRoverRunning) return;

    this.driveState = `TELEOP: ${cmd}`;
    this.updateDriveStateDisplay();

    if (cmd === 'FORWARD') {
      if (this.videoFeed) this.videoFeed.roverSpeed = (this.currentThrottle / 100) * 1.5;
    } else if (cmd === 'REVERSE') {
      if (this.videoFeed) this.videoFeed.roverSpeed = -(this.currentThrottle / 100) * 0.8;
    } else if (cmd === 'LEFT') {
      if (this.videoFeed) this.videoFeed.updateAttitude(this.videoFeed.cameraPitch, -4.5);
    } else if (cmd === 'RIGHT') {
      if (this.videoFeed) this.videoFeed.updateAttitude(this.videoFeed.cameraPitch, 4.5);
    } else if (cmd === 'BRAKE') {
      if (this.videoFeed) this.videoFeed.roverSpeed = 0;
    }
  }

  releaseTeleopCommand(cmd) {
    if (!this.isRoverRunning) return;

    this.driveState = 'PATROLLING';
    this.updateDriveStateDisplay();

    if (this.videoFeed) {
      this.videoFeed.roverSpeed = (this.currentThrottle / 100) * 1.0;
      this.videoFeed.updateAttitude(1.2, -0.8);
    }
  }

  updateDriveStateDisplay() {
    const badge = document.getElementById('drive-state-display');
    const hudStatus = document.getElementById('hud-drive-status');
    if (badge) {
      badge.innerText = `STATUS: ${this.driveState}`;
      if (this.driveState === 'HALTED' || this.driveState === 'EMERGENCY_STOP') {
        badge.style.borderColor = 'var(--status-danger)';
        badge.style.color = 'var(--status-danger)';
        badge.style.background = 'rgba(255, 42, 95, 0.1)';
      } else {
        badge.style.borderColor = 'rgba(0, 255, 136, 0.3)';
        badge.style.color = 'var(--status-safe)';
        badge.style.background = 'rgba(0, 255, 136, 0.1)';
      }
    }
    if (hudStatus) {
      hudStatus.innerText = this.driveState;
    }
  }

  triggerEmergencyEvacuation() {
    this.isEmergencyActive = true;
    this.driveState = 'EMERGENCY_STOP';
    this.isRoverRunning = false;
    this.updateDriveStateDisplay();

    // 1. Show Strobe Warning Overlay
    const strobe = document.getElementById('emergency-strobe');
    if (strobe) strobe.classList.remove('hidden');

    // 2. Start Blasting Emergency Siren
    this.audioSynth.startEmergencySiren();

    // 3. Halt Rover Video & Propel Hoist
    if (this.videoFeed) this.videoFeed.roverSpeed = 0;
    if (this.hoistController) this.hoistController.triggerEmergencyEvac();

    // 4. Update UI Status Badges
    const badge = document.getElementById('evac-status-badge');
    if (badge) {
      badge.innerText = 'EVACUATION IN PROGRESS';
      badge.style.background = 'var(--status-danger)';
      badge.style.color = '#ffffff';
    }

    const resetBtn = document.getElementById('reset-evac-btn');
    if (resetBtn) resetBtn.classList.remove('hidden');

    this.updateAnnunciator(false, false, true, true);
  }

  resetEmergencyEvacuation() {
    this.isEmergencyActive = false;
    this.safetyCoverOpen = false;
    this.isRoverRunning = true;
    this.driveState = 'PATROLLING';
    this.updateDriveStateDisplay();

    // 1. Hide Strobe Overlay
    const strobe = document.getElementById('emergency-strobe');
    if (strobe) strobe.classList.add('hidden');

    // 2. Stop Siren
    this.audioSynth.stopEmergencySiren();

    // 3. Reset Hoist
    if (this.hoistController) this.hoistController.resetHoist();

    // 4. Reset Safety Cover & Buttons
    const safetyCover = document.getElementById('safety-cover');
    const evacBtn = document.getElementById('emergency-evac-btn');
    const resetBtn = document.getElementById('reset-evac-btn');
    const badge = document.getElementById('evac-status-badge');
    const coverLockIcon = document.getElementById('cover-lock-icon');

    if (safetyCover) safetyCover.classList.remove('flipped');
    if (coverLockIcon) coverLockIcon.innerText = '🔒';
    if (evacBtn) evacBtn.setAttribute('disabled', 'true');
    if (resetBtn) resetBtn.classList.add('hidden');
    if (badge) {
      badge.innerText = 'SYSTEM ARMED';
      badge.style.background = 'rgba(255, 42, 95, 0.15)';
      badge.style.color = 'var(--status-danger)';
    }

    // Reset hazards to normal
    this.injectHazardScenario('normal');
  }

  injectHazardScenario(type) {
    if (type === 'normal') {
      this.sensorData.gas = 142;
      this.sensorData.smoke = 28;
      this.sensorData.flame = 0;
      this.sensorData.vibration = 0.04;
      this.sensorData.distance = 142;
      this.sensorData.temp = 24.6;
      if (this.videoFeed) {
        this.videoFeed.setHazardStates({ gasLeak: false, flame: false, caveIn: false, survivor: true });
      }
      this.audioSynth.stopWarningAlarm();
      this.hideCameraHazardBanner();
    } else if (type === 'gas') {
      this.sensorData.gas = 520; // Critical Methane leak
      this.sensorData.smoke = 45;
      this.sensorData.flame = 0;
      if (this.videoFeed) {
        this.videoFeed.setHazardStates({ gasLeak: true, flame: false, caveIn: false });
      }
      this.audioSynth.startWarningAlarm();
      this.showCameraHazardBanner('⚠️ AI WARNING: COMBUSTIBLE GAS LEAK (CH4: 520 PPM)');
    } else if (type === 'fire') {
      this.sensorData.flame = 780; // High IR flame radiation
      this.sensorData.smoke = 210;
      this.sensorData.temp = 48.5;
      if (this.videoFeed) {
        this.videoFeed.setHazardStates({ gasLeak: false, flame: true, caveIn: false });
      }
      this.audioSynth.startWarningAlarm();
      this.showCameraHazardBanner('🔥 CRITICAL: OPTICAL IR FLAME & SMOKE SIGNATURE DETECTED');
    } else if (type === 'seismic') {
      this.sensorData.vibration = 1.15; // Tremor / rockburst
      if (this.videoFeed) {
        this.videoFeed.setHazardStates({ gasLeak: false, flame: false, caveIn: false });
        this.videoFeed.updateAttitude(6.5, -8.2);
      }
      this.audioSynth.startWarningAlarm();
      this.showCameraHazardBanner('⚡ STRUCTURAL ALARM: SEISMIC VIBRATION BURST 1.15g');
    } else if (type === 'obstacle') {
      this.sensorData.distance = 18; // Obstacle 18cm ahead
      if (this.videoFeed) {
        this.videoFeed.setHazardStates({ gasLeak: false, flame: false, caveIn: true, survivor: false });
      }
      if (this.autoObstacleGuard) {
        this.driveState = 'OBSTACLE_HALT (18cm)';
        this.updateDriveStateDisplay();
        if (this.videoFeed) this.videoFeed.roverSpeed = 0;
      }
      this.showCameraHazardBanner('🚧 OBSTACLE BLOCKED: DRIFT CAVE-IN COLLAPSE 0.18m');
    } else if (type === 'catastrophic') {
      this.sensorData.gas = 680;
      this.sensorData.flame = 920;
      this.sensorData.vibration = 1.85;
      this.sensorData.smoke = 380;
      this.sensorData.distance = 12;
      this.sensorData.temp = 54.0;
      if (this.videoFeed) {
        this.videoFeed.setHazardStates({ gasLeak: true, flame: true, caveIn: true });
      }
      this.showCameraHazardBanner('🚨 MULTI-HAZARD EMERGENCY: CAVE-IN & INFERNO DETECTED');
      this.triggerEmergencyEvacuation();
    }
  }

  showCameraHazardBanner(msg) {
    const banner = document.getElementById('hud-hazard-banner');
    const text = document.getElementById('hud-hazard-text');
    if (banner && text) {
      text.innerText = msg;
      banner.classList.remove('hidden');
    }
  }

  hideCameraHazardBanner() {
    const banner = document.getElementById('hud-hazard-banner');
    if (banner) banner.classList.add('hidden');
  }

  startMainLoops() {
    // 1. High frequency telemetry & ML evaluation loop (5 Hz)
    setInterval(() => {
      this.tickTelemetry();
    }, 200);

    // 2. 1-second Clock & Battery physics ticker
    setInterval(() => {
      this.tickClockAndBattery();
    }, 1000);
  }

  tickTelemetry() {
    // Add micro-noise in simulation mode to mimic real ADC readings
    if (this.mode === 'SIMULATION') {
      this.sensorData.gas += (Math.random() - 0.5) * 3;
      this.sensorData.smoke += (Math.random() - 0.5) * 1.5;
      this.sensorData.vibration += (Math.random() - 0.5) * 0.006;
      this.sensorData.distance += (Math.random() - 0.5) * 1.2;
      this.sensorData.temp += (Math.random() - 0.5) * 0.05;

      // Keep within sane physical bounds
      this.sensorData.gas = Math.max(40, this.sensorData.gas);
      this.sensorData.smoke = Math.max(10, this.sensorData.smoke);
      this.sensorData.vibration = Math.max(0.01, this.sensorData.vibration);
      this.sensorData.distance = Math.max(5, this.sensorData.distance);
    }

    // Pass data through AI/ML Classifier
    let prediction = null;
    if (this.aiEngine) {
      prediction = this.aiEngine.predictHazard(this.sensorData);
    }

    // Update Sparklines & DOM Sensors
    this.updateSensorDOM();

    // Update Physical 16x2 LCD mirror
    this.updateLcdMirror(prediction ? prediction.label : 'NORMAL');

    // Update Hardware Annunciator LEDs
    if (!this.isEmergencyActive) {
      const isDanger = prediction && (prediction.label === 'CRITICAL' || prediction.label === 'EMERGENCY');
      const isWarning = prediction && prediction.label === 'WARNING';
      const isNormal = !isDanger && !isWarning;
      this.updateAnnunciator(isNormal, isWarning, isDanger, isDanger || isWarning);
    }
  }

  updateSensorDOM() {
    const s = this.sensorData;

    // Push into sparkline arrays
    this.pushHistory('gas', s.gas);
    this.pushHistory('smoke', s.smoke);
    this.pushHistory('flame', s.flame);
    this.pushHistory('vibration', s.vibration);
    this.pushHistory('distance', s.distance);
    this.pushHistory('temp', s.temp);

    // Render text & progress bars
    this.setSensorCard('gas', Math.round(s.gas), s.gas > 300 ? 'danger' : s.gas > 220 ? 'warning' : 'safe', s.gas > 300 ? 'DANGER' : s.gas > 220 ? 'WARNING' : 'SAFE', Math.min(100, (s.gas / 600) * 100));
    this.setSensorCard('smoke', Math.round(s.smoke), s.smoke > 100 ? 'danger' : s.smoke > 60 ? 'warning' : 'safe', s.smoke > 100 ? 'SMOKE HIGH' : 'CLEAR', Math.min(100, (s.smoke / 200) * 100));
    this.setSensorCard('flame', Math.round(s.flame), s.flame > 350 ? 'danger' : 'safe', s.flame > 350 ? 'FIRE DETECTED' : 'NO FLAME', Math.min(100, (s.flame / 1023) * 100));
    this.setSensorCard('vib', s.vibration.toFixed(2), s.vibration > 0.5 ? 'danger' : s.vibration > 0.2 ? 'warning' : 'safe', s.vibration > 0.5 ? 'DISTURBANCE' : 'STABLE', Math.min(100, (s.vibration / 1.5) * 100));
    this.setSensorCard('dist', Math.round(s.distance), s.distance < 30 ? 'danger' : s.distance < 60 ? 'warning' : 'safe', s.distance < 30 ? 'OBSTACLE' : 'CLEAR', Math.min(100, (s.distance / 200) * 100));
    
    // Climate
    const tempVal = document.getElementById('val-temp');
    if (tempVal) tempVal.innerText = `${s.temp.toFixed(1)}°C / ${Math.round(s.humidity)}%`;

    // Draw Sparklines
    this.drawSparkline('spark-gas', this.history.gas, '#00ff88', '#ff2a5f', 300);
    this.drawSparkline('spark-smoke', this.history.smoke, '#00f0ff', '#ffb800', 100);
    this.drawSparkline('spark-flame', this.history.flame, '#94a3b8', '#ff2a5f', 350);
    this.drawSparkline('spark-vib', this.history.vibration, '#a855f7', '#ff2a5f', 0.5);
    this.drawSparkline('spark-dist', this.history.distance, '#00f0ff', '#ff2a5f', 30, true);
    this.drawSparkline('spark-temp', this.history.temp, '#ffb800', '#ff2a5f', 40);

    // Update HUD distance indicator
    const hudDist = document.getElementById('hud-obstacle-dist');
    if (hudDist) hudDist.innerText = `${(s.distance / 100).toFixed(2)} m`;
  }

  setSensorCard(id, val, badgeClass, badgeText, pct) {
    const valEl = document.getElementById(`val-${id}`);
    const badgeEl = document.getElementById(`badge-${id}`);
    const barEl = document.getElementById(`bar-${id}`);

    if (valEl) valEl.innerText = val;
    if (badgeEl) {
      badgeEl.className = `hazard-level-badge ${badgeClass}`;
      badgeEl.innerText = badgeText;
    }
    if (barEl) {
      barEl.style.width = `${pct}%`;
      barEl.className = `sensor-bar-fill ${badgeClass}`;
    }
  }

  pushHistory(key, val) {
    this.history[key].push(val);
    if (this.history[key].length > 25) this.history[key].shift();
  }

  drawSparkline(canvasId, data, safeColor, dangerColor, threshold, invert = false) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    const min = Math.min(...data);
    const max = Math.max(...data, threshold);
    const range = max - min || 1;

    const lastVal = data[data.length - 1];
    const isOver = invert ? (lastVal < threshold) : (lastVal > threshold);
    const strokeColor = isOver ? dangerColor : safeColor;

    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 1.8;
    ctx.beginPath();

    for (let i = 0; i < data.length; i++) {
      const x = (i / (data.length - 1)) * w;
      const normY = (data[i] - min) / range;
      const y = h - 2 - normY * (h - 4);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  updateLcdMirror(mlLabel) {
    const line1 = document.getElementById('lcd-line-1');
    const line2 = document.getElementById('lcd-line-2');
    if (!line1 || !line2) return;

    this.lcdCycle = (this.lcdCycle + 1) % 6;

    if (this.isEmergencyActive) {
      line1.innerText = '!! EVACUATION !!';
      line2.innerText = 'HOIST ENGAGED 9V';
    } else if (this.lcdCycle < 3) {
      // Screen 1: Gas & Flame
      line1.innerText = `GAS:${Math.round(this.sensorData.gas)}PPM FLM:${this.sensorData.flame > 350 ? '1' : '0'}`;
      line2.innerText = `VIB:${this.sensorData.vibration.toFixed(2)}G DST:${Math.round(this.sensorData.distance)}`;
    } else {
      // Screen 2: Climate, Battery & ML status
      line1.innerText = `TMP:${this.sensorData.temp.toFixed(0)}C BAT:${Math.round(this.sensorData.battery)}%`;
      line2.innerText = `AI: ${mlLabel.slice(0, 12)}`;
    }
  }

  updateAnnunciator(normal, warning, danger, buzzer) {
    const ledNormal = document.getElementById('led-normal');
    const ledWarn = document.getElementById('led-warning');
    const ledDanger = document.getElementById('led-danger');
    const buzzerSpeaker = document.getElementById('buzzer-speaker-indicator');
    const buzzerLabel = document.getElementById('buzzer-state-label');

    if (ledNormal) ledNormal.classList.toggle('active', normal);
    if (ledWarn) ledWarn.classList.toggle('active', warning);
    if (ledDanger) ledDanger.classList.toggle('active', danger);

    if (buzzerSpeaker) buzzerSpeaker.classList.toggle('active', buzzer);
    if (buzzerLabel) buzzerLabel.innerText = buzzer ? 'BUZZER ACTIVE' : 'BUZZER OFF';
  }

  tickClockAndBattery() {
    // 1. Mission Clock
    this.missionSeconds++;
    const hrs = String(Math.floor(this.missionSeconds / 3600)).padStart(2, '0');
    const mins = String(Math.floor((this.missionSeconds % 3600) / 60)).padStart(2, '0');
    const secs = String(this.missionSeconds % 60).padStart(2, '0');
    const clockEl = document.getElementById('mission-clock');
    if (clockEl) clockEl.innerText = `${hrs}:${mins}:${secs}`;

    // 2. Battery Discharge Simulation
    if (this.isRoverRunning) {
      this.sensorData.battery -= 0.012; // Slow discharge
      this.sensorData.batteryVolt = 7.4 + (this.sensorData.battery / 100) * 1.0;
      this.sensorData.currentDraw = 1.35 + (this.currentThrottle / 100) * 0.5;
    } else {
      this.sensorData.currentDraw = 0.28; // Idle ESP32 standby draw
    }

    const fillLevel = document.getElementById('battery-fill-level');
    const pctText = document.getElementById('battery-pct-text');
    const voltText = document.getElementById('batt-voltage');
    const currentText = document.getElementById('batt-current');
    const powerText = document.getElementById('batt-power');
    const runtimeText = document.getElementById('batt-runtime');
    const statusTag = document.getElementById('battery-status-tag');

    const pct = Math.max(0, Math.round(this.sensorData.battery));

    if (pctText) pctText.innerText = `${pct}%`;
    if (fillLevel) {
      fillLevel.style.width = `${pct}%`;
      fillLevel.className = `battery-fill-level ${pct < 20 ? 'danger' : pct < 50 ? 'warning' : ''}`;
    }
    if (voltText) voltText.innerText = `${this.sensorData.batteryVolt.toFixed(2)} V`;
    if (currentText) currentText.innerText = `${this.sensorData.currentDraw.toFixed(2)} A`;
    if (powerText) powerText.innerText = `${(this.sensorData.batteryVolt * this.sensorData.currentDraw).toFixed(1)} W`;
    
    // Remaining hours
    const remHours = (pct / 22).toFixed(1);
    if (runtimeText) runtimeText.innerText = `${remHours}h remaining`;
    if (statusTag) {
      statusTag.innerText = pct < 20 ? 'LOW BATTERY WARNING' : 'NORMAL DISCHARGE';
      statusTag.style.color = pct < 20 ? 'var(--status-danger)' : 'var(--status-safe)';
    }

    // Packet Counter Increment
    const packetCounter = document.getElementById('packet-counter');
    if (packetCounter) {
      const current = parseInt(packetCounter.innerText.replace(/\D/g, '')) || 1428;
      packetCounter.innerText = `PACKETS RECEIVED: ${(current + 5).toLocaleString()}`;
    }
  }

  openSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (modal) modal.classList.remove('hidden');
  }

  testEsp32Connection() {
    const statusText = document.getElementById('bridge-status-text');
    if (statusText) statusText.innerText = `Connecting to ESP32 at http://${this.esp32Ip}/data...`;

    // Attempt fetch with short timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    fetch(`http://${this.esp32Ip}/data`, { signal: controller.signal })
      .then(res => res.json())
      .then(data => {
        clearTimeout(timeoutId);
        if (statusText) statusText.innerText = `Success! Connected to ESP32 Dev Module at ${this.esp32Ip}.`;
        this.updateSystemStatusChip(true, `ESP32 CONNECTED (${this.esp32Ip})`);
      })
      .catch(err => {
        clearTimeout(timeoutId);
        if (statusText) statusText.innerText = `ESP32 unreachable at ${this.esp32Ip}. Reverting to high-fidelity autonomous simulation mode.`;
        this.updateSystemStatusChip(true, 'SYSTEM ONLINE (SIM)');
      });
  }

  updateSystemStatusChip(online, label) {
    const dot = document.getElementById('status-pulse-dot');
    const text = document.getElementById('status-text');
    if (dot) {
      dot.className = online ? 'status-dot online' : 'status-dot offline';
    }
    if (text) {
      text.innerText = label;
    }
  }
}

/**
 * Tactical Web Audio Synthesizer
 * Uses Web Audio API for synthetic alarm beeps and mine emergency sirens
 */
class TacticalAudioSynthesizer {
  constructor() {
    this.ctx = null;
    this.isMuted = false;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.sirenTimer = null;
    this.warningTimer = null;
  }

  initContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  setMuted(muted) {
    this.isMuted = muted;
    if (muted) {
      this.stopEmergencySiren();
      this.stopWarningAlarm();
    }
  }

  playClickSound() {
    if (this.isMuted) return;
    this.initContext();
    if (!this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(400, this.ctx.currentTime + 0.04);

    gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, this.ctx.currentTime + 0.04);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.04);
  }

  playArmSound() {
    if (this.isMuted) return;
    this.initContext();
    if (!this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(500, this.ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(1100, this.ctx.currentTime + 0.15);

    gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, this.ctx.currentTime + 0.15);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.15);
  }

  startEmergencySiren() {
    if (this.isMuted) return;
    this.initContext();
    if (!this.ctx || this.sirenOsc) return;

    this.sirenOsc = this.ctx.createOscillator();
    this.sirenGain = this.ctx.createGain();
    this.sirenOsc.type = 'sawtooth';

    this.sirenGain.gain.setValueAtTime(0.2, this.ctx.currentTime);
    this.sirenOsc.connect(this.sirenGain);
    this.sirenGain.connect(this.ctx.destination);
    this.sirenOsc.start();

    // Modulate pitch between 600Hz and 1600Hz continuously
    let high = false;
    this.sirenTimer = setInterval(() => {
      if (!this.ctx || !this.sirenOsc) return;
      const targetFreq = high ? 600 : 1600;
      this.sirenOsc.frequency.exponentialRampToValueAtTime(targetFreq, this.ctx.currentTime + 0.6);
      high = !high;
    }, 600);
  }

  stopEmergencySiren() {
    if (this.sirenTimer) {
      clearInterval(this.sirenTimer);
      this.sirenTimer = null;
    }
    if (this.sirenOsc) {
      try {
        this.sirenOsc.stop();
        this.sirenOsc.disconnect();
      } catch (e) {}
      this.sirenOsc = null;
    }
  }

  startWarningAlarm() {
    if (this.isMuted || this.warningTimer) return;
    this.initContext();

    this.warningTimer = setInterval(() => {
      if (this.isMuted || !this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(950, this.ctx.currentTime);

      gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.01, this.ctx.currentTime + 0.12);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.12);
    }, 800);
  }

  stopWarningAlarm() {
    if (this.warningTimer) {
      clearInterval(this.warningTimer);
      this.warningTimer = null;
    }
  }
}

// Initialize application on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  window.oreoApp = new OreoDashboardApp();
});
