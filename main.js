import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { VoxelWorld, createTextureAtlas } from './src/VoxelWorld.js';
import { Player } from './src/Player.js';
import { InputManager } from './src/InputManager.js';

// --- Global Variables ---
const VERSION = "1.3";
console.log(`BlockMiner v${VERSION} Initializing...`);

let camera, scene, renderer, controls;
let voxelWorld;
let player;
let inputManager;
let prevTime = performance.now();
const cellSize = 32;
const chunkMap = {};
let currentBlockType = 3;

const blockNames = {
    1: "Dirt",
    2: "Grass",
    3: "Stone",
    4: "Wood",
    5: "Obsidian"
};

try {
    init();
    animate();
} catch (e) {
    console.error(e);
    alert(`Game Error (v${VERSION}): ` + e.message);
}

function init() {
    // 1. Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB); // Sky Blue
    scene.fog = new THREE.Fog(0x87CEEB, 10, 60);

    // 2. Camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(cellSize / 2, 20, cellSize / 2); // Position is managed by Player, but we set initial

    // 3. Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);

    // 4. Light
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
    hemiLight.position.set(0, 50, 0);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(20, 50, 10);
    dirLight.castShadow = true;
    scene.add(dirLight);

    // 5. Voxel World Setup
    const tileSize = 64;
    const tileTextureWidth = 512;
    const tileTextureHeight = 512;

    voxelWorld = new VoxelWorld({
        cellSize,
        tileSize,
        tileTextureWidth,
        tileTextureHeight,
    });

    // Generate Terrain
    for (let y = 0; y < cellSize; ++y) {
        for (let z = 0; z < cellSize; ++z) {
            for (let x = 0; x < cellSize; ++x) {
                // Bedrock floor
                if (y === 0) {
                    voxelWorld.setVoxel(x, y, z, 3);
                    continue;
                }
                const height = (Math.sin(x / 4) + Math.cos(z / 4)) * 2 + 5; // Simple waves
                if (y < height) {
                    voxelWorld.setVoxel(x, y, z, y < height - 1 ? 1 : 2); // 1=Dirt, 2=Grass
                }
            }
        }
    }

    // Update Mesh
    updateVoxelGeometry(0, 0, 0);

    // 6. Controls & Input
    controls = new PointerLockControls(camera, document.body);

    const instructions = document.getElementById('instructions');
    const ui = document.getElementById('ui');

    instructions.addEventListener('click', function () {
        controls.lock();
    });

    controls.addEventListener('lock', function () {
        instructions.style.display = 'none';
        ui.style.pointerEvents = 'none';
    });

    controls.addEventListener('unlock', function () {
        instructions.style.display = 'block';
        ui.style.pointerEvents = 'auto';
    });

    scene.add(controls.getObject());

    inputManager = new InputManager();
    player = new Player(camera, controls, voxelWorld);

    // ... previous code

    // 8. Interaction Logic
    document.addEventListener('mouseup', (e) => {
        performRaycastAction(e.button);
    });

    // Prevent context menu for Right Click interaction
    window.addEventListener('contextmenu', e => e.preventDefault());

    // Resize Handler
    window.addEventListener('resize', onWindowResize);

    updateBlockUI();
}

const performRaycastAction = (button) => {
    if (controls.isLocked) {
        const start = new THREE.Vector3();
        const end = new THREE.Vector3();
        start.setFromMatrixPosition(camera.matrixWorld);
        end.set(0, 0, 1).unproject(camera);

        const direction = new THREE.Vector3();
        camera.getWorldDirection(direction);
        end.copy(start).add(direction.multiplyScalar(10));

        const intersection = voxelWorld.intersectRay(start, end);
        if (intersection) {
            const pos = intersection.position;
            let targetPos = [...pos]; // Position of the block to modify

            if (button === 0) {
                // Mine
                voxelWorld.setVoxel(targetPos[0], targetPos[1], targetPos[2], 0);
            } else if (button === 2) {
                // Place
                const normal = intersection.normal;
                targetPos = [pos[0] + normal[0], pos[1] + normal[1], pos[2] + normal[2]];

                // Don't place inside player (Simple box check)
                const playerPos = new THREE.Vector3();
                playerPos.copy(controls.getObject().position);
                const pBox = new THREE.Box3();
                pBox.setFromCenterAndSize(
                    new THREE.Vector3(playerPos.x, playerPos.y - 0.85, playerPos.z),
                    new THREE.Vector3(0.6, 1.7, 0.6)
                );

                const bBox = new THREE.Box3();
                bBox.min.set(targetPos[0], targetPos[1], targetPos[2]);
                bBox.max.set(targetPos[0] + 1, targetPos[1] + 1, targetPos[2] + 1);

                if (pBox.intersectsBox(bBox)) return; // Abort if intersecting

                voxelWorld.setVoxel(targetPos[0], targetPos[1], targetPos[2], currentBlockType);
            }

            // Update the chunk containing the block
            const chunkX = Math.floor(targetPos[0] / cellSize);
            const chunkY = Math.floor(targetPos[1] / cellSize);
            const chunkZ = Math.floor(targetPos[2] / cellSize);

            updateVoxelGeometry(chunkX, chunkY, chunkZ);

            // Update neighbors if on border (Simple brute force for MVP: update all neighbors? No, too slow. Just check.)
            // Actually, let's just implement correct border checks.
            const voxelX = THREE.MathUtils.euclideanModulo(targetPos[0], cellSize);
            const voxelY = THREE.MathUtils.euclideanModulo(targetPos[1], cellSize);
            const voxelZ = THREE.MathUtils.euclideanModulo(targetPos[2], cellSize);

            if (voxelX === 0) updateVoxelGeometry(chunkX - 1, chunkY, chunkZ);
            if (voxelX === cellSize - 1) updateVoxelGeometry(chunkX + 1, chunkY, chunkZ);
            if (voxelY === 0) updateVoxelGeometry(chunkX, chunkY - 1, chunkZ);
            if (voxelY === cellSize - 1) updateVoxelGeometry(chunkX, chunkY + 1, chunkZ);
            if (voxelZ === 0) updateVoxelGeometry(chunkX, chunkY, chunkZ - 1);
            if (voxelZ === cellSize - 1) updateVoxelGeometry(chunkX, chunkY, chunkZ + 1);
        }
    }
};

window.addEventListener('keydown', (e) => {
    if (e.key >= '1' && e.key <= '5') {
        currentBlockType = parseInt(e.key);
        updateBlockUI();
    }
    if (e.code === 'KeyF') {
        // 'F' to Place (simulate right click behavior -> button 2)
        performRaycastAction(2);
    }
});

function updateBlockUI() {
    const el = document.getElementById('block-indicator');
    if (el) {
        el.innerText = `Selected: ${blockNames[currentBlockType] || 'Unknown'}`;
    }
}


function updateVoxelGeometry(x, y, z) {
    const chunkId = `${x},${y},${z}`;

    // Remove existing chunk mesh
    let chunk = chunkMap[chunkId];
    if (chunk) {
        scene.remove(chunk);
        chunk.geometry.dispose();
    }

    const { positions, normals, uvs, indices } = voxelWorld.generateGeometryDataForCell(x, y, z);

    // If no geometry (empty chunk), stop here
    if (positions.length === 0) {
        delete chunkMap[chunkId];
        return;
    }

    const geometry = new THREE.BufferGeometry();
    const material = new THREE.MeshLambertMaterial({
        map: createTextureAtlas(),
        side: THREE.FrontSide,
        alphaTest: 0.1,
        transparent: false,
    });

    const positionNumComponents = 3;
    const normalNumComponents = 3;
    const uvNumComponents = 2;

    geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(positions), positionNumComponents));
    geometry.setAttribute(
        'normal',
        new THREE.BufferAttribute(new Float32Array(normals), normalNumComponents));
    geometry.setAttribute(
        'uv',
        new THREE.BufferAttribute(new Float32Array(uvs), uvNumComponents));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    chunkMap[chunkId] = mesh;
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);

    try {
        const time = performance.now();
        const delta = (time - prevTime) / 1000;
        prevTime = time;

        // Safety Cap on Delta to prevent huge jumps
        const safeDelta = Math.min(delta, 0.1);

        if (player) { // Ensure player is init
            player.update(safeDelta, inputManager.state);
        }

        renderer.render(scene, camera);
    } catch (e) {
        console.error("Animate Error:", e);
        // Throttle alerts? No, just stop?
        // Let's just update the debug UI or alert once.
        // Alerting in a loop is death. Use a flag.
        if (!window.hasAlertedError) {
            window.hasAlertedError = true;
            alert("Runtime Error: " + e.message);
        }
    }
}
