/**
 * OREO - 9V Motor & Pulley / Hoist Rescue Mechanism Controller
 * Simulates and controls the relay-driven 9V motor and pulley/lifting winch system,
 * cable tension physics, hoist ascent/descent, and emergency evacuation triggers.
 */

class RescueHoistController {
  constructor() {
    this.depth = 180.0; // Current depth in meters (-180.0m)
    this.maxDepth = 180.0;
    this.minDepth = 0.0; // Surface level
    
    this.motorState = 'STOPPED'; // 'ASCENDING', 'DESCENDING', 'STOPPED'
    this.motorVoltage = 0.0; // 0.0V or 9.0V (Relay state)
    this.motorRPM = 0;
    this.cableTension = 480; // Newtons
    this.ascentSpeed = 1.2; // meters per update tick

    this.wheelEl = document.getElementById('pulley-wheel');
    this.cableEl = document.getElementById('hoist-cable');
    this.capsuleEl = document.getElementById('rescue-capsule');
    
    this.depthValEl = document.getElementById('hoist-depth-val');
    this.tensionValEl = document.getElementById('hoist-tension-val');
    this.relayVoltEl = document.getElementById('hoist-relay-volt');
    this.relayChipEl = document.getElementById('relay-state-chip');
    this.motorRpmEl = document.getElementById('motor-rpm-text');

    this.initEventListeners();
    this.startPhysicsLoop();
  }

  initEventListeners() {
    const upBtn = document.getElementById('hoist-up-btn');
    const downBtn = document.getElementById('hoist-down-btn');
    const brakeBtn = document.getElementById('hoist-halt-btn');

    if (upBtn) {
      upBtn.addEventListener('click', () => this.setMotorState('ASCENDING'));
    }
    if (downBtn) {
      downBtn.addEventListener('click', () => this.setMotorState('DESCENDING'));
    }
    if (brakeBtn) {
      brakeBtn.addEventListener('click', () => this.setMotorState('STOPPED'));
    }
  }

  setMotorState(state) {
    this.motorState = state;

    if (state === 'ASCENDING') {
      this.motorVoltage = 9.0;
      this.motorRPM = 420;
      this.cableTension = 620;
      if (this.wheelEl) {
        this.wheelEl.className = 'pulley-wheel spinning-up';
      }
    } else if (state === 'DESCENDING') {
      this.motorVoltage = 9.0;
      this.motorRPM = 380;
      this.cableTension = 390;
      if (this.wheelEl) {
        this.wheelEl.className = 'pulley-wheel spinning-down';
      }
    } else {
      this.motorVoltage = 0.0;
      this.motorRPM = 0;
      this.cableTension = 480;
      if (this.wheelEl) {
        this.wheelEl.className = 'pulley-wheel';
      }
    }

    this.updateUI();
  }

  startPhysicsLoop() {
    setInterval(() => {
      if (this.motorState === 'ASCENDING') {
        if (this.depth > this.minDepth) {
          this.depth = Math.max(this.minDepth, this.depth - this.ascentSpeed);
        } else {
          // Reached surface!
          this.setMotorState('STOPPED');
          if (this.capsuleEl) {
            this.capsuleEl.style.boxShadow = '0 0 20px #00ff88';
          }
        }
      } else if (this.motorState === 'DESCENDING') {
        if (this.depth < this.maxDepth) {
          this.depth = Math.min(this.maxDepth, this.depth + this.ascentSpeed);
        } else {
          // Reached bottom drift!
          this.setMotorState('STOPPED');
        }
      }

      this.updateUI();
    }, 100);
  }

  updateUI() {
    // Hoist Visual elements:
    // Scale 180m depth to 180px in borehole view
    const pixelPos = (this.depth / this.maxDepth) * 160 + 10;
    
    if (this.cableEl) {
      this.cableEl.style.height = `${pixelPos}px`;
    }
    if (this.capsuleEl) {
      this.capsuleEl.style.top = `${pixelPos}px`;
    }

    // Telemetry text
    if (this.depthValEl) {
      this.depthValEl.innerText = `-${this.depth.toFixed(1)} m`;
    }
    if (this.tensionValEl) {
      this.tensionValEl.innerText = `${Math.round(this.cableTension + (Math.random() - 0.5) * 8)} N`;
    }
    if (this.relayVoltEl) {
      this.relayVoltEl.innerText = this.motorVoltage > 0 ? '9.0 V (ENERGIZED)' : '0.0 V (OPEN)';
    }
    if (this.relayChipEl) {
      this.relayChipEl.innerText = this.motorVoltage > 0 ? 'RELAY: ACTIVE (9V)' : 'RELAY: OFF (0V)';
      this.relayChipEl.style.color = this.motorVoltage > 0 ? '#00ff88' : 'inherit';
    }
    if (this.motorRpmEl) {
      this.motorRpmEl.innerText = `${this.motorRPM} RPM`;
    }
  }

  triggerEmergencyEvac() {
    // Automatically spool cable and rapidly ascend capsule to surface
    this.ascentSpeed = 2.4; // Rapid emergency ascent speed
    this.setMotorState('ASCENDING');
  }

  resetHoist() {
    this.depth = 180.0;
    this.ascentSpeed = 1.2;
    this.setMotorState('STOPPED');
  }
}

// Export instance
window.RescueHoistController = RescueHoistController;
