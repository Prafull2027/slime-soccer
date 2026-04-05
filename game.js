/**
 * ============================================================
 *  SLIME SOCCER — Complete Game Engine
 *  Pure ES6+ JavaScript, HTML5 Canvas, no external libraries
 * ============================================================
 */

'use strict';

// ─────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────
const W = 800;
const H = 450;
const GROUND_Y = 380;          // y-coordinate of the playing surface
const GRAVITY = 0.55;
const SLIME_RADIUS = 44;       // half-circle radius
const BALL_RADIUS = 16;
const JUMP_FORCE = -14;
const MOVE_SPEED = 5.5;
const FRICTION = 0.80;         // ground friction
const BALL_FRICTION = 0.988;   // air friction on ball
const BALL_GROUND_FRICTION = 0.92;
const BALL_BOUNCE = 0.65;
const SLIME_BOUNCE = 0.55;

// Goal dimensions
const GOAL_WIDTH  = 14;
const GOAL_HEIGHT = 100;
const GOAL_LEFT_X  = 0;                          // left inner wall x
const GOAL_RIGHT_X = W - GOAL_WIDTH;             // right inner wall x
const GOAL_Y = GROUND_Y - GOAL_HEIGHT;           // top of goal opening

// Anti-camping thresholds (seconds)
const CAMP_WARN_TIME  = 5;
const CAMP_RESET_TIME = 8;

// ─────────────────────────────────────────────
//  UTILITY – Vector2D
// ─────────────────────────────────────────────
class Vec2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  add(v)   { return new Vec2(this.x + v.x, this.y + v.y); }
  sub(v)   { return new Vec2(this.x - v.x, this.y - v.y); }
  scale(s) { return new Vec2(this.x * s, this.y * s); }
  dot(v)   { return this.x * v.x + this.y * v.y; }
  len()    { return Math.sqrt(this.x * this.x + this.y * this.y); }
  norm()   {
    const l = this.len();
    return l > 0 ? this.scale(1 / l) : new Vec2();
  }
  clone()  { return new Vec2(this.x, this.y); }
}

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function randBetween(a, b) { return a + Math.random() * (b - a); }

// ─────────────────────────────────────────────
//  INPUT HANDLER
// ─────────────────────────────────────────────
const Input = {
  keys: {},

  init() {
    window.addEventListener('keydown', e => {
      this.keys[e.code] = true;
      // Prevent arrow key / space scrolling
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', e => {
      this.keys[e.code] = false;
    });
  },

  held(code)    { return !!this.keys[code]; },

  // Player 1: Arrow keys + Space/ArrowDown grab
  p1Left()     { return this.held('ArrowLeft'); },
  p1Right()    { return this.held('ArrowRight'); },
  p1Jump()     { return this.held('ArrowUp'); },
  p1Grab()     { return this.held('ArrowDown') || this.held('Space'); },

  // Player 2: WASD + S/ShiftLeft grab
  p2Left()     { return this.held('KeyA'); },
  p2Right()    { return this.held('KeyD'); },
  p2Jump()     { return this.held('KeyW'); },
  p2Grab()     { return this.held('KeyS') || this.held('ShiftLeft'); },
};

// ─────────────────────────────────────────────
//  BALL
// ─────────────────────────────────────────────
class Ball {
  constructor() {
    this.r   = BALL_RADIUS;
    this.pos = new Vec2(W / 2, GROUND_Y - 80);
    this.vel = new Vec2(randBetween(-2, 2), -3);
    this.grabbed = null;   // reference to grabbing Slime or null
    this.angle   = 0;      // visual rotation
    this.angVel  = 0;
    this.glowTimer = 0;    // flash when goal scored
  }

  reset() {
    this.pos  = new Vec2(W / 2, GROUND_Y - 120);
    this.vel  = new Vec2(randBetween(-2, 2), -2);
    this.grabbed = null;
    this.angle   = 0;
    this.angVel  = 0;
    this.glowTimer = 0;
  }

  /** Attach ball to a slime (offset from slime center) */
  grab(slime) {
    this.grabbed = slime;
  }

  release(slime) {
    if (this.grabbed !== slime) return;
    this.grabbed = null;
    // Kick: velocity based on slime velocity + angular release
    const kickMulti = 2.0;
    this.vel.x = slime.vel.x * kickMulti + this.angVel * 4;
    this.vel.y = slime.vel.y * kickMulti - Math.abs(this.angVel) * 2 - 2;
    this.angVel *= 0.5;
  }

  update(slimes) {
    if (this.grabbed) {
      // Follow owner slime
      const owner = this.grabbed;
      const side  = owner.facingRight ? 1 : -1;
      const armAngle = owner.grabAngle;
      this.pos.x = owner.pos.x + Math.cos(armAngle) * (SLIME_RADIUS * 0.8) * side;
      this.pos.y = owner.pos.y - Math.sin(armAngle) * (SLIME_RADIUS * 0.8) - SLIME_RADIUS * 0.1;
      this.angVel = owner.vel.x * 0.08;
      this.angle += this.angVel;
      return;
    }

    // Gravity
    this.vel.y += GRAVITY;

    // Air friction
    this.vel.x *= BALL_FRICTION;
    this.vel.y *= BALL_FRICTION;

    this.pos.x += this.vel.x;
    this.pos.y += this.vel.y;

    // Rotation
    this.angVel  = this.vel.x * 0.06;
    this.angle  += this.angVel;

    // Ground bounce
    if (this.pos.y + this.r >= GROUND_Y) {
      this.pos.y = GROUND_Y - this.r;
      this.vel.y = -Math.abs(this.vel.y) * BALL_BOUNCE;
      this.vel.x *= BALL_GROUND_FRICTION;
      if (Math.abs(this.vel.y) < 1.2) this.vel.y = 0;
    }

    // Ceiling
    if (this.pos.y - this.r <= 0) {
      this.pos.y = this.r;
      this.vel.y = Math.abs(this.vel.y) * BALL_BOUNCE;
    }

    // Side walls — but allow the ball to enter goal areas
    // Left wall (outside left goal)
    if (this.pos.x - this.r < GOAL_LEFT_X + GOAL_WIDTH) {
      // Inside goal mouth
      if (this.pos.y > GOAL_Y) {
        // Let it go into goal — goal check handles scoring
        if (this.pos.x - this.r < GOAL_LEFT_X) {
          this.pos.x = GOAL_LEFT_X + this.r;
          this.vel.x = Math.abs(this.vel.x) * BALL_BOUNCE;
        }
      } else {
        this.pos.x = GOAL_LEFT_X + GOAL_WIDTH + this.r;
        this.vel.x = Math.abs(this.vel.x) * BALL_BOUNCE;
      }
    }

    // Right wall
    if (this.pos.x + this.r > GOAL_RIGHT_X) {
      if (this.pos.y > GOAL_Y) {
        if (this.pos.x + this.r > W) {
          this.pos.x = W - this.r;
          this.vel.x = -Math.abs(this.vel.x) * BALL_BOUNCE;
        }
      } else {
        this.pos.x = GOAL_RIGHT_X - this.r;
        this.vel.x = -Math.abs(this.vel.x) * BALL_BOUNCE;
      }
    }

    // Slime–ball collision
    for (const s of slimes) {
      this._resolveSlimeCollision(s);
    }

    if (this.glowTimer > 0) this.glowTimer--;
  }

  _resolveSlimeCollision(slime) {
    // Slime is a semicircle; treat as full circle for collision
    const dx   = this.pos.x - slime.pos.x;
    const dy   = this.pos.y - slime.pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const minD = this.r + SLIME_RADIUS;

    if (dist < minD && dist > 0) {
      // Only collide if ball is in upper half region of slime
      if (this.pos.y < slime.pos.y + SLIME_RADIUS * 0.4) {
        const nx    = dx / dist;
        const ny    = dy / dist;
        const overlap = minD - dist;

        // Push ball out
        this.pos.x += nx * overlap;
        this.pos.y += ny * overlap;

        // Relative velocity
        const dvx = this.vel.x - slime.vel.x;
        const dvy = this.vel.y - slime.vel.y;
        const dot  = dvx * nx + dvy * ny;

        if (dot < 0) {
          const restitution = SLIME_BOUNCE;
          const impulse = (-(1 + restitution) * dot);
          this.vel.x += impulse * nx;
          this.vel.y += impulse * ny;
        }
      }
    }
  }

  /** Returns true if ball is fully inside left goal */
  inLeftGoal()  {
    return this.pos.x - this.r <= GOAL_LEFT_X + GOAL_WIDTH &&
           this.pos.y + this.r >= GOAL_Y &&
           this.pos.y <= GROUND_Y;
  }

  /** Returns true if ball is fully inside right goal */
  inRightGoal() {
    return this.pos.x + this.r >= GOAL_RIGHT_X &&
           this.pos.y + this.r >= GOAL_Y &&
           this.pos.y <= GROUND_Y;
  }
}

// ─────────────────────────────────────────────
//  SLIME
// ─────────────────────────────────────────────
class Slime {
  /**
   * @param {number} x  - initial x
   * @param {string} color - CSS color string
   * @param {'left'|'right'} side
   */
  constructor(x, color, side) {
    this.pos   = new Vec2(x, GROUND_Y);
    this.vel   = new Vec2(0, 0);
    this.r     = SLIME_RADIUS;
    this.color = color;
    this.side  = side;   // 'left' or 'right'
    this.onGround = true;
    this.jumpQueued = false;
    this.facingRight = (side === 'right');

    // Grab arm
    this.grabbing   = false;
    this.grabAngle  = Math.PI / 3;  // radians above horizontal

    // Visual squash/stretch
    this.squashX = 1;
    this.squashY = 1;

    // Anti-camping
    this.campTimer  = 0;  // seconds in own goal area
    this.campWarning = false;
    this.campReset   = false;

    // Bounds (so slimes can't leave the field)
    this.leftBound  = GOAL_LEFT_X + GOAL_WIDTH + this.r;
    this.rightBound = GOAL_RIGHT_X - this.r;
  }

  /** Move slime based on inputs. Call once per frame. */
  applyInput(left, right, jump, grab, ball) {
    // Horizontal movement
    if (left) {
      this.vel.x -= MOVE_SPEED * 0.38;
      this.facingRight = false;
    }
    if (right) {
      this.vel.x += MOVE_SPEED * 0.38;
      this.facingRight = true;
    }

    // Ground friction (applied horizontally on ground)
    if (this.onGround) {
      this.vel.x *= FRICTION;
      if (!left && !right) {
        this.vel.x *= 0.82;
      }
    }

    // Speed cap
    this.vel.x = clamp(this.vel.x, -MOVE_SPEED, MOVE_SPEED);

    // Jump
    if (jump && this.onGround) {
      this.vel.y = JUMP_FORCE;
      this.onGround = false;
      this.squashY = 0.6;
      this.squashX = 1.4;
    }

    // Grab / release
    if (grab) {
      if (!this.grabbing) {
        // Try to grab ball if nearby
        const dx = ball.pos.x - this.pos.x;
        const dy = ball.pos.y - this.pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < this.r + ball.r + 10 && !ball.grabbed) {
          this.grabbing = true;
          ball.grab(this);
        }
      }
    } else {
      if (this.grabbing) {
        this.grabbing = false;
        ball.release(this);
      }
    }

    // Move grab angle while holding
    if (this.grabbing) {
      this.grabAngle += 0.05 * (this.vel.x === 0 ? 0 : (this.vel.x > 0 ? 1 : -1));
      this.grabAngle  = clamp(this.grabAngle, 0.1, Math.PI * 0.9);
    }
  }

  update() {
    // Gravity
    if (!this.onGround) {
      this.vel.y += GRAVITY;
    }

    this.pos.x += this.vel.x;
    this.pos.y += this.vel.y;

    // Ground
    if (this.pos.y >= GROUND_Y) {
      this.pos.y = GROUND_Y;
      if (this.vel.y > 0) {
        if (this.vel.y > 5) {
          this.squashY = 0.65;
          this.squashX = 1.35;
        }
        this.vel.y = 0;
      }
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    // Horizontal bounds
    this.pos.x = clamp(this.pos.x, this.leftBound, this.rightBound);
    if (this.pos.x === this.leftBound || this.pos.x === this.rightBound) {
      this.vel.x *= -0.3;
    }

    // Squash recovery (lerp back to 1)
    this.squashX = lerp(this.squashX, 1, 0.18);
    this.squashY = lerp(this.squashY, 1, 0.18);
  }

  /** Is slime inside its own goal area? */
  isInOwnGoal() {
    if (this.side === 'left') {
      return this.pos.x - this.r < GOAL_LEFT_X + GOAL_WIDTH + 10;
    } else {
      return this.pos.x + this.r > GOAL_RIGHT_X - 10;
    }
  }

  reset(x) {
    this.pos  = new Vec2(x, GROUND_Y);
    this.vel  = new Vec2(0, 0);
    this.onGround = true;
    this.grabbing = false;
    this.campTimer = 0;
    this.campWarning = false;
    this.campReset   = false;
  }
}

// ─────────────────────────────────────────────
//  AI OPPONENT
// ─────────────────────────────────────────────
class AI {
  constructor(slime) {
    this.slime = slime;
    this.reactionDelay = 0;   // frames
    this.difficulty    = 0.82; // 0–1
    this._jumpTimer    = 0;
    this._grabTimer    = 0;
    this._lastBallX    = 0;
  }

  /** Returns simulated input object each frame */
  computeInput(ball, opponentSlime) {
    const s = this.slime;

    // Predicted ball position (simple linear extrapolation)
    const predFrames = 18;
    const predX = ball.pos.x + ball.vel.x * predFrames;
    const predY = ball.pos.y + ball.vel.y * predFrames + 0.5 * GRAVITY * predFrames * predFrames;

    // Decide whether to attack or defend
    const ballOnMySide = ball.pos.x > W * 0.5;
    const ballComingFast = Math.abs(ball.vel.x) > 3 && (
      (s.side === 'right' && ball.vel.x > 0) ||
      (s.side === 'left'  && ball.vel.x < 0)
    );

    let targetX;

    if (ballOnMySide || ballComingFast) {
      // Attack: go to predicted position
      targetX = predX;
    } else {
      // Defend: position near own goal, but not camping it
      const goalCenterX = s.side === 'right' ? W - GOAL_WIDTH - SLIME_RADIUS - 10 : GOAL_WIDTH + SLIME_RADIUS + 10;
      targetX = lerp(ball.pos.x, goalCenterX, 0.55);
    }

    // Clamp target to field
    targetX = clamp(targetX, s.leftBound + 2, s.rightBound - 2);

    const dx    = targetX - s.pos.x;
    const speed = Math.abs(dx);

    const left  = dx < -6;
    const right = dx >  6;

    // Jump logic
    let jump = false;
    this._jumpTimer = Math.max(0, this._jumpTimer - 1);
    const ballAbove = ball.pos.y < s.pos.y - SLIME_RADIUS * 0.7;
    const ballClose = Math.abs(ball.pos.x - s.pos.x) < SLIME_RADIUS * 2.5;
    if (ballAbove && ballClose && s.onGround && this._jumpTimer === 0) {
      jump = true;
      this._jumpTimer = 20 + Math.floor(randBetween(0, 15));
    }
    // Jump to block or shoot
    if (ball.pos.y < GROUND_Y - 80 && ballClose && s.onGround && this._jumpTimer === 0) {
      jump = true;
      this._jumpTimer = 18;
    }

    // Grab logic
    let grab = false;
    this._grabTimer = Math.max(0, this._grabTimer - 1);
    if (ballClose && !ball.grabbed && this._grabTimer === 0) {
      grab = true;
      this._grabTimer = 30 + Math.floor(randBetween(0, 20));
    }
    if (s.grabbing) {
      // Hold briefly then release toward opponent goal
      if (this._grabTimer <= 0) {
        grab = false; // release
      } else {
        grab = true;
      }
    }

    return { left, right, jump, grab };
  }
}

// ─────────────────────────────────────────────
//  RENDERER
// ─────────────────────────────────────────────
class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
  }

  clear() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
  }

  drawField() {
    const ctx = this.ctx;

    // Sky / background
    ctx.fillStyle = '#001133';
    ctx.fillRect(0, 0, W, H);

    // Field surface
    ctx.fillStyle = '#004d00';
    ctx.fillRect(GOAL_LEFT_X + GOAL_WIDTH, GROUND_Y, W - GOAL_WIDTH * 2, H - GROUND_Y);

    // Center line
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(W / 2, 0);
    ctx.lineTo(W / 2, GROUND_Y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Center circle
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(W / 2, GROUND_Y, 70, Math.PI, 2 * Math.PI);
    ctx.stroke();

    // Ground line
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(GOAL_LEFT_X + GOAL_WIDTH, GROUND_Y);
    ctx.lineTo(GOAL_RIGHT_X, GROUND_Y);
    ctx.stroke();
  }

  drawGoal(side, campWarning) {
    const ctx  = this.ctx;
    const isLeft = side === 'left';

    const gx = isLeft ? GOAL_LEFT_X : GOAL_RIGHT_X;
    const gy = GOAL_Y;
    const gw = GOAL_WIDTH;
    const gh = GOAL_HEIGHT;

    // Camp warning zone
    if (campWarning) {
      ctx.fillStyle = 'rgba(255, 50, 50, 0.18)';
      ctx.fillRect(gx, gy, gw + SLIME_RADIUS * 2, gh + 30);
    }

    // Back wall
    ctx.fillStyle = '#222';
    ctx.fillRect(gx, gy, gw, gh);

    // Net pattern
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 0.8;
    const nLines = 5;
    for (let i = 0; i <= nLines; i++) {
      const ny = gy + (gh / nLines) * i;
      ctx.beginPath();
      ctx.moveTo(gx, ny);
      ctx.lineTo(gx + gw, ny);
      ctx.stroke();
    }
    for (let i = 0; i <= 2; i++) {
      const nx = gx + (gw / 2) * i;
      ctx.beginPath();
      ctx.moveTo(nx, gy);
      ctx.lineTo(nx, gy + gh);
      ctx.stroke();
    }

    // Goal posts
    ctx.fillStyle = '#ffffff';
    // top crossbar
    ctx.fillRect(isLeft ? gx + gw - 4 : gx, gy - 4, gw + 4, 5);
    // ground post
    ctx.fillRect(isLeft ? gx + gw - 4 : gx, GROUND_Y - 3, 5, 6);
  }

  drawSlime(slime) {
    const ctx = this.ctx;
    const x   = slime.pos.x;
    const y   = slime.pos.y;
    const r   = slime.r;
    const sx  = slime.squashX;
    const sy  = slime.squashY;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sx, sy);

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(0, 4, r * 0.9, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    // Slime body (semicircle)
    const gradient = ctx.createRadialGradient(-r * 0.25, -r * 0.35, r * 0.05, 0, 0, r);
    const c = slime.color;
    gradient.addColorStop(0, lightenColor(c, 50));
    gradient.addColorStop(0.6, c);
    gradient.addColorStop(1, darkenColor(c, 40));

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, r, Math.PI, 0);
    ctx.closePath();
    ctx.fill();

    // Highlight
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath();
    ctx.arc(-r * 0.27, -r * 0.38, r * 0.32, 0, Math.PI * 2);
    ctx.fill();

    // Eyes
    const eyeOffX = slime.facingRight ? r * 0.3 : -r * 0.3;
    const eyeOffX2 = slime.facingRight ? r * 0.6 : -r * 0.6;

    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(eyeOffX2, -r * 0.45, 7, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(eyeOffX,  -r * 0.6,  7, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = '#000000';
    ctx.beginPath(); ctx.arc(eyeOffX2 + (slime.facingRight ? 2 : -2), -r * 0.45, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(eyeOffX  + (slime.facingRight ? 2 : -2), -r * 0.6,  3.5, 0, Math.PI * 2); ctx.fill();

    // Grab arm indicator
    if (slime.grabbing) {
      const side = slime.facingRight ? 1 : -1;
      ctx.strokeStyle = lightenColor(slime.color, 30);
      ctx.lineWidth   = 5;
      ctx.lineCap     = 'round';
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.1);
      ctx.lineTo(
        Math.cos(slime.grabAngle) * r * 0.85 * side,
        -Math.sin(slime.grabAngle) * r * 0.85
      );
      ctx.stroke();
    }

    ctx.restore();
  }

  drawBall(ball) {
    const ctx = this.ctx;
    const x   = ball.pos.x;
    const y   = ball.pos.y;
    const r   = ball.r;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ball.angle);

    // Glow when grabbed
    if (ball.grabbed || ball.glowTimer > 0) {
      const alpha = ball.grabbed ? 0.5 : ball.glowTimer / 30 * 0.5;
      ctx.shadowColor = '#ffff00';
      ctx.shadowBlur  = 20;
    }

    // Shadow
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(2, r - 2, r * 0.85, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Ball gradient
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, 1, 0, 0, r);
    g.addColorStop(0,   '#ffffff');
    g.addColorStop(0.3, '#eeeeee');
    g.addColorStop(1,   '#999999');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    // Soccer pattern (simplified)
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.45, 0, Math.PI * 2);
    ctx.stroke();

    // Pentagon patches
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2;
      const px = Math.cos(angle) * r * 0.52;
      const py = Math.sin(angle) * r * 0.52;
      ctx.fillStyle = '#333';
      ctx.beginPath();
      ctx.arc(px, py, r * 0.18, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  drawHUD(state) {
    const ctx  = this.ctx;
    const pad  = 12;

    // Score panel background
    const panelW = 220;
    const panelH = 52;
    const panelX = (W - panelW) / 2;
    const panelY = pad;

    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    this._roundRect(panelX, panelY, panelW, panelH, 8);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1;
    this._roundRect(panelX, panelY, panelW, panelH, 8);
    ctx.stroke();

    // Score text
    ctx.font      = 'bold 28px "Press Start 2P", monospace';
    ctx.textAlign = 'center';

    // Left score (cyan)
    ctx.fillStyle = '#00ffff';
    ctx.shadowColor = '#00ffff';
    ctx.shadowBlur  = 8;
    ctx.fillText(String(state.scoreLeft), panelX + 52, panelY + 36);

    // Separator
    ctx.fillStyle = '#ffffff';
    ctx.shadowBlur = 0;
    ctx.font = 'bold 20px "Press Start 2P", monospace';
    ctx.fillText('—', panelX + panelW / 2, panelY + 34);

    // Right score (red)
    ctx.fillStyle = '#ff4444';
    ctx.shadowColor = '#ff4444';
    ctx.shadowBlur  = 8;
    ctx.font = 'bold 28px "Press Start 2P", monospace';
    ctx.fillText(String(state.scoreRight), panelX + panelW - 52, panelY + 36);

    ctx.shadowBlur = 0;

    // Timer
    const minutes = Math.floor(state.timeLeft / 60);
    const seconds = Math.floor(state.timeLeft % 60);
    const timeStr = `${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;

    const timerWarning = state.timeLeft < 30;
    ctx.font = '11px "Press Start 2P", monospace';
    ctx.fillStyle = timerWarning ? (Math.floor(Date.now() / 400) % 2 ? '#ff4444' : '#ffff00') : '#ffffff';
    ctx.fillText(timeStr, W / 2, panelY + panelH + 16);

    // Game mode label
    ctx.font      = '7px "Press Start 2P", monospace';
    ctx.fillStyle = '#555';
    ctx.fillText(state.mode === 'single' ? 'VS AI' : '2-PLAYER', W / 2, panelY + panelH + 28);

    // Anti-camping warnings
    if (state.campWarnLeft) {
      this._drawCampWarning('left', state.campTimerLeft);
    }
    if (state.campWarnRight) {
      this._drawCampWarning('right', state.campTimerRight);
    }

    // Controls reminder (faint, bottom)
    ctx.font      = '6px "Press Start 2P", monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.textAlign = 'left';
    ctx.fillText('P1: ←→ MOVE  ↑ JUMP  ↓/SPC GRAB', 8, H - 22);
    if (state.mode === 'multi') {
      ctx.textAlign = 'right';
      ctx.fillText('P2: AD MOVE  W JUMP  S/SHIFT GRAB', W - 8, H - 22);
    }
    ctx.textAlign = 'left';

    // ESC hint
    ctx.font = '6px "Press Start 2P", monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.textAlign = 'right';
    ctx.fillText('ESC: PAUSE', W - 8, H - 8);
    ctx.textAlign = 'left';
  }

  _drawCampWarning(side, timer) {
    const ctx    = this.ctx;
    const blink  = Math.floor(Date.now() / 300) % 2;
    const alpha  = blink ? 0.85 : 0.4;
    const x      = side === 'left' ? 60 : W - 140;

    ctx.save();
    ctx.font      = '8px "Press Start 2P", monospace';
    ctx.fillStyle = `rgba(255, 80, 0, ${alpha})`;
    ctx.textAlign = 'center';
    ctx.fillText('⚠ CAMPING!', x + 40, 100);
    const remaining = Math.max(0, CAMP_RESET_TIME - timer).toFixed(1);
    ctx.font = '7px "Press Start 2P", monospace';
    ctx.fillStyle = `rgba(255,200,0,${alpha})`;
    ctx.fillText(`RESET IN ${remaining}s`, x + 40, 115);
    ctx.restore();
  }

  drawGoalFlash(alpha) {
    const ctx = this.ctx;
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.fillRect(0, 0, W, H);
  }

  drawPauseOverlay() {
    // Handled by DOM overlay
  }

  _roundRect(x, y, w, h, radius) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }
}

// ─────────────────────────────────────────────
//  COLOR HELPERS
// ─────────────────────────────────────────────
function parseColor(hex) {
  // Accept css color names and hex
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const ctx = c.getContext('2d');
  ctx.fillStyle = hex;
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}

// Cache parsed colors
const _colorCache = {};
function getColorParts(color) {
  if (!_colorCache[color]) _colorCache[color] = parseColor(color);
  return _colorCache[color];
}

function lightenColor(color, amount) {
  const [r, g, b] = getColorParts(color);
  return `rgb(${clamp(r + amount, 0, 255)},${clamp(g + amount, 0, 255)},${clamp(b + amount, 0, 255)})`;
}

function darkenColor(color, amount) {
  return lightenColor(color, -amount);
}

// ─────────────────────────────────────────────
//  GAME STATE MANAGER
// ─────────────────────────────────────────────
class Game {
  constructor() {
    this.canvas    = document.getElementById('game-canvas');
    this.renderer  = new Renderer(this.canvas);

    // Screens
    this.screenMenu     = document.getElementById('screen-menu');
    this.screenPause    = document.getElementById('screen-pause');
    this.screenGameover = document.getElementById('screen-gameover');

    // State
    this.state = 'menu';  // 'menu' | 'playing' | 'paused' | 'gameover'
    this.mode  = 'single';
    this.matchDuration = 180; // seconds (default 3 min)

    // Score
    this.scoreLeft  = 0;
    this.scoreRight = 0;

    // Timer
    this.timeLeft    = this.matchDuration;
    this.lastTime    = 0;

    // Goal flash
    this.goalFlash   = 0;   // alpha 0–1

    // Entities
    this.slimeLeft  = new Slime(W * 0.25, '#00ffff', 'left');
    this.slimeRight = new Slime(W * 0.75, '#ff3333', 'right');
    this.ball       = new Ball();

    // AI
    this.ai = new AI(this.slimeRight);

    // Camp timers (seconds)
    this.campTimerLeft  = 0;
    this.campTimerRight = 0;

    this._bindUI();
    Input.init();

    this._loop = this._loop.bind(this);
  }

  // ─── UI BINDINGS ────────────────────────────
  _bindUI() {
    // Menu
    document.getElementById('btn-single').addEventListener('click', () => {
      this.mode = 'single';
      this._startGame();
    });
    document.getElementById('btn-multi').addEventListener('click', () => {
      this.mode = 'multi';
      this._startGame();
    });

    // Duration buttons
    document.querySelectorAll('.duration-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.duration-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        this.matchDuration = parseInt(btn.dataset.mins) * 60;
      });
    });

    // Pause screen
    document.getElementById('btn-resume').addEventListener('click', () => this._resume());
    document.getElementById('btn-menu-from-pause').addEventListener('click', () => this._goToMenu());

    // Game over screen
    document.getElementById('btn-restart').addEventListener('click', () => this._startGame());
    document.getElementById('btn-menu-from-over').addEventListener('click', () => this._goToMenu());

    // ESC to pause / resume
    window.addEventListener('keydown', e => {
      if (e.code === 'Escape') {
        if (this.state === 'playing') this._pause();
        else if (this.state === 'paused') this._resume();
      }
    });
  }

  _startGame() {
    this.scoreLeft  = 0;
    this.scoreRight = 0;
    this.timeLeft   = this.matchDuration;
    this.campTimerLeft  = 0;
    this.campTimerRight = 0;

    this.slimeLeft.reset(W * 0.25);
    this.slimeRight.reset(W * 0.75);
    this.ball.reset();

    this._showScreen(null);
    this.state = 'playing';
    this.lastTime = performance.now();
    requestAnimationFrame(this._loop);
  }

  _pause() {
    this.state = 'paused';
    this._showScreen('pause');
  }

  _resume() {
    this.state = 'playing';
    this._showScreen(null);
    this.lastTime = performance.now();
    requestAnimationFrame(this._loop);
  }

  _goToMenu() {
    this.state = 'menu';
    this._showScreen('menu');
  }

  _gameOver() {
    this.state = 'gameover';

    const goLeft  = document.getElementById('go-score-left');
    const goRight = document.getElementById('go-score-right');
    const winner  = document.getElementById('winner-text');

    goLeft.textContent  = String(this.scoreLeft);
    goRight.textContent = String(this.scoreRight);

    if (this.scoreLeft > this.scoreRight) {
      winner.textContent = '🏆 CYAN WINS!';
      winner.style.color = '#00ffff';
    } else if (this.scoreRight > this.scoreLeft) {
      winner.textContent = '🏆 RED WINS!';
      winner.style.color = '#ff4444';
    } else {
      winner.textContent = '🤝 IT\'S A DRAW!';
      winner.style.color = '#ffffff';
    }

    this._showScreen('gameover');
  }

  _showScreen(name) {
    this.screenMenu.classList.add('hidden');
    this.screenPause.classList.add('hidden');
    this.screenGameover.classList.add('hidden');

    if (name === 'menu')     this.screenMenu.classList.remove('hidden');
    if (name === 'pause')    this.screenPause.classList.remove('hidden');
    if (name === 'gameover') this.screenGameover.classList.remove('hidden');
  }

  // ─── GOAL SCORED ────────────────────────────
  _onGoalScored(side) {
    if (side === 'right') {
      this.scoreLeft++;   // ball in right goal = left (cyan) player scored
    } else {
      this.scoreRight++;  // ball in left goal = right (red) player scored
    }

    this.goalFlash = 1.0;
    this.ball.glowTimer = 60;

    // Brief freeze
    setTimeout(() => {
      this.slimeLeft.reset(W * 0.25);
      this.slimeRight.reset(W * 0.75);
      this.ball.reset();
      this.campTimerLeft  = 0;
      this.campTimerRight = 0;
    }, 700);
  }

  // ─── MAIN LOOP ──────────────────────────────
  _loop(timestamp) {
    if (this.state !== 'playing') return;

    const dt = Math.min((timestamp - this.lastTime) / 1000, 0.05);
    this.lastTime = timestamp;

    this._update(dt);
    this._render();

    requestAnimationFrame(this._loop);
  }

  _update(dt) {
    // Countdown timer
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this._gameOver();
      return;
    }

    // ── P1 INPUT ─────────────────────────────
    this.slimeLeft.applyInput(
      Input.p1Left(),
      Input.p1Right(),
      Input.p1Jump(),
      Input.p1Grab(),
      this.ball
    );

    // ── P2 / AI INPUT ────────────────────────
    if (this.mode === 'single') {
      const aiInput = this.ai.computeInput(this.ball, this.slimeLeft);
      this.slimeRight.applyInput(
        aiInput.left,
        aiInput.right,
        aiInput.jump,
        aiInput.grab,
        this.ball
      );
    } else {
      this.slimeRight.applyInput(
        Input.p2Left(),
        Input.p2Right(),
        Input.p2Jump(),
        Input.p2Grab(),
        this.ball
      );
    }

    // ── PHYSICS UPDATE ───────────────────────
    this.slimeLeft.update();
    this.slimeRight.update();
    this.ball.update([this.slimeLeft, this.slimeRight]);

    // ── ANTI-CAMPING ─────────────────────────
    this._updateCamping(dt);

    // ── GOAL DETECTION ───────────────────────
    if (this.ball.inLeftGoal()) {
      this._onGoalScored('left');
    } else if (this.ball.inRightGoal()) {
      this._onGoalScored('right');
    }

    // ── GOAL FLASH FADE ──────────────────────
    if (this.goalFlash > 0) {
      this.goalFlash = Math.max(0, this.goalFlash - 0.04);
    }
  }

  _updateCamping(dt) {
    // Left slime in left goal
    if (this.slimeLeft.isInOwnGoal()) {
      this.campTimerLeft += dt;
    } else {
      this.campTimerLeft = Math.max(0, this.campTimerLeft - dt * 0.5);
    }

    // Right slime in right goal
    if (this.slimeRight.isInOwnGoal()) {
      this.campTimerRight += dt;
    } else {
      this.campTimerRight = Math.max(0, this.campTimerRight - dt * 0.5);
    }

    // Warn / reset
    if (this.campTimerLeft >= CAMP_RESET_TIME) {
      this.ball.reset();
      this.slimeLeft.reset(W * 0.25);
      this.campTimerLeft = 0;
    }
    if (this.campTimerRight >= CAMP_RESET_TIME) {
      this.ball.reset();
      this.slimeRight.reset(W * 0.75);
      this.campTimerRight = 0;
    }
  }

  _render() {
    const r = this.renderer;

    r.clear();
    r.drawField();

    // Goals (with camp warning)
    r.drawGoal('left',  this.campTimerLeft  >= CAMP_WARN_TIME);
    r.drawGoal('right', this.campTimerRight >= CAMP_WARN_TIME);

    r.drawSlime(this.slimeLeft);
    r.drawSlime(this.slimeRight);
    r.drawBall(this.ball);

    r.drawHUD({
      scoreLeft:  this.scoreLeft,
      scoreRight: this.scoreRight,
      timeLeft:   this.timeLeft,
      mode:       this.mode,
      campWarnLeft:   this.campTimerLeft  >= CAMP_WARN_TIME,
      campWarnRight:  this.campTimerRight >= CAMP_WARN_TIME,
      campTimerLeft:  this.campTimerLeft,
      campTimerRight: this.campTimerRight,
    });

    // Goal flash overlay
    if (this.goalFlash > 0) {
      r.drawGoalFlash(this.goalFlash * 0.6);
    }
  }
}

// ─────────────────────────────────────────────
//  BOOT
// ─────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  const game = new Game();
  // Show the main menu screen
  game._showScreen('menu');
});
