import * as THREE from 'three';

export class Player {
    constructor(camera, controls, voxelWorld) {
        this.camera = camera;
        this.controls = controls;
        this.voxelWorld = voxelWorld;
        this.velocity = new THREE.Vector3();
        this.direction = new THREE.Vector3();
        this.canJump = false;

        // Physics constants
        this.gravity = 30.0;
        this.jumpForce = 12.0;
        this.moveSpeed = 10.0;

        // Player dimensions
        this.radius = 0.3;
        this.height = 1.7;
    }

    update(delta, input) {
        if (!this.controls.isLocked) return;

        // Apply Gravity
        this.velocity.y -= this.gravity * delta;

        // Input Movement
        this.direction.z = Number(input.forward) - Number(input.backward);
        this.direction.x = Number(input.right) - Number(input.left);
        this.direction.normalize();

        if (input.forward || input.backward) this.velocity.z -= this.direction.z * 100.0 * delta;
        if (input.left || input.right) this.velocity.x -= this.direction.x * 100.0 * delta;

        // Dampen Velocity
        const damping = 10.0;
        this.velocity.x -= this.velocity.x * damping * delta;
        this.velocity.z -= this.velocity.z * damping * delta;

        // Move Player (Collision Detection)
        this.applyPhysics(delta);

        // Jump
        if (input.jump && this.canJump) {
            this.velocity.y = this.jumpForce;
            this.canJump = false;
        }
    }

    applyPhysics(delta) {
        // We move axis by axis to prevent getting stuck

        // 1. Move X
        const dx = this.velocity.x * delta;
        this.controls.moveRight(-dx); // Note: PointerLockControls x is lateral
        // Check collision
        if (this.checkCollision()) {
            this.controls.moveRight(dx); // Undo
            this.velocity.x = 0;
        }

        // 2. Move Z
        const dz = this.velocity.z * delta;
        this.controls.moveForward(-dz);
        // Check collision
        if (this.checkCollision()) {
            this.controls.moveForward(dz); // Undo
            this.velocity.z = 0;
        }

        // 3. Move Y
        this.controls.getObject().position.y += this.velocity.y * delta;
        if (this.checkCollision()) {
            this.controls.getObject().position.y -= this.velocity.y * delta; // Undo

            // If falling and hit something, we are on ground
            if (this.velocity.y < 0) {
                this.canJump = true;
            }
            this.velocity.y = 0;
        }
    }

    checkCollision() {
        // Simple discrete collision: check 8 corners of the bounding box
        // Actually, just checking waist and feet is often enough for simple voxels,
        // but let's check a few points relative to position.

        const pos = this.controls.getObject().position;
        const x = pos.x;
        const y = pos.y;
        const z = pos.z;

        // Bounding box offsets
        const r = this.radius;
        const h = this.height;

        // Check feet (slightly above bottom), waist, head (slightly below top)
        // We only check if center + radius enters a solid block

        // Helper to check one point
        const isSolid = (px, py, pz) => {
            const vx = Math.floor(px);
            const vy = Math.floor(py);
            const vz = Math.floor(pz);
            const voxel = this.voxelWorld.getVoxel(vx, vy, vz);
            if (voxel !== 0) {
                this.lastHit = `Hit: ${vx},${vy},${vz} (Val:${voxel})`;
                return true;
            }
            return false;
        };

        // Floor level (just below feet to catch ground? No, we moved. Check inside body.)
        // We check 3 vertical levels: bottom (y-h), middle (y-h/2), top (y) - Camera is at eye level (top)

        // Camera is at y. Feet are at y - height.
        // Let's assume camera is at top of player.

        const footY = y - h;
        const headY = y - 0.1;

        // Check 4 corners at feet and head
        const corners = [
            [x - r, z - r],
            [x + r, z - r],
            [x - r, z + r],
            [x + r, z + r]
        ];

        for (const [cx, cz] of corners) {
            if (isSolid(cx, footY, cz)) return true;
            if (isSolid(cx, headY, cz)) return true;
            if (isSolid(cx, (footY + headY) / 2, cz)) return true; // Waist
        }

        return false;
    }

    get debugHit() {
        return this.lastHit || "None";
    }
}
