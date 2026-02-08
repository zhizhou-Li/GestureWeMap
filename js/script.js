// 静态原型：不依赖后端，隐藏登录/用户相关 UI
(function initNavForStatic() {
  const loginButton = document.getElementById('loginButton');
  const userInfo = document.getElementById('userInfo');
  const logoutButton = document.getElementById('logoutButton');
  if (loginButton) loginButton.classList.add('hidden');
  if (userInfo) userInfo.classList.add('hidden');
  if (logoutButton) logoutButton.classList.add('hidden');
})();
// 参数配置
const CONFIG = {
  // 手势距离阈值（相对于食指长度的比例）
  thumbIndexPinchRatio: 0.2, // 拇指-食指捏合（缩放），距离/食指长度
  thumbIndexSpreadRatio: 0.6, // 拇指-食指张开（放大），距离/食指长度
  middleRingLittleRatio: 0.3, // 中指-无名指-小指靠近，距离/食指长度
  pointDistanceClose: 0.05, // 绘制点：食指-中指靠近（绝对距离）
  pointDistanceOpen: 0.10, // 绘制点：食指-中指张开（绝对距离）
  faceCloseDistance: 0.05, // 绘制面：闭合距离（绝对距离）
  pointInterval: 1000, // 绘制点/线/面的最小时间间隔（ms）
  zoomInterval: 1000, // 缩放手势最小时间间隔（ms）
  zoomStep: 0.5, // 每次缩放的级别增量
  zoomAnimationDuration: 400, // 缩放动画持续时间（ms）
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.7,
  minTrackingConfidence: 0.7,
  markerIcon: 'https://webapi.amap.com/theme/v1.3/markers/n/mark_b.png',
  markerOffsetX: -12,
  markerOffsetY: -12,
  tempMarkerOpacity: 0.5,
  lineStrokeColor: '#00aaff',
  lineStrokeWeight: 4,
  faceFillColor: 'rgba(0, 170, 255, 0.3)',
  faceStrokeColor: '#00aaff',
  faceStrokeWeight: 2,
  landmarkPointSize: 10,
  landmarkPointColor: 'rgba(0, 255, 0, 0.8)',
  connectionLineColor: 'rgba(0, 255, 255, 0.6)',
  connectionLineWidth: 4
};

// 初始化高德地图（强制Canvas渲染）
const map = new AMap.Map('map', {
  zoom: 10,
  center: [116.397428, 39.90923],
  renderer: 'canvas', // 强制使用Canvas渲染器
  doubleClickZoom: false,
  animateEnable: false,
  WebGLParams: {
    preserveDrawingBuffer: true
  }
});

const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// 将手部 canvas 放入 body 下的固定 overlay，确保浮于地图之上（避免被 AMap 内部层遮挡）
function ensureHandOverlay() {
  let overlay = document.getElementById('hand-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'hand-overlay';
    overlay.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;';
    overlay.appendChild(canvas);
    document.body.appendChild(overlay);
  }
  const mapEl = document.querySelector('.map-container');
  if (mapEl) {
    const rect = mapEl.getBoundingClientRect();
    overlay.style.top = rect.top + 'px';
    overlay.style.left = rect.left + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
    canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }
}
map.on('complete', ensureHandOverlay);
window.addEventListener('resize', ensureHandOverlay);
window.addEventListener('scroll', ensureHandOverlay, true);
const cameraSelect = document.getElementById('cameraSelect');
const statusText = document.getElementById('status-text');
const toggleGestureButton = document.getElementById('toggleGesture');
const statusIndicator = document.querySelector('.status-indicator');
const startCameraButton = document.getElementById('startCameraButton');
const cameraPrompt = document.getElementById('cameraPrompt');
const permissionMessage = document.getElementById('permissionMessage');
const permissionGuide = document.getElementById('permissionGuide');

let currentStream = null;
let polyline = null;
let polygon = null;
let path = [];
let tempMarker = null;
let tempLngLat = null;
let lastPointTime = 0;
let lastZoomTime = 0;
let markers = [];
let polylines = [];
let polygons = [];
let gestureEnabled = true;
let isZooming = false; // 动画状态标志

// 使用 CDN 加载 MediaPipe 资源，避免与高德地图的 Module 冲突
const hands = new Hands({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
  maxNumHands: CONFIG.maxNumHands,
  modelComplexity: CONFIG.modelComplexity,
  minDetectionConfidence: CONFIG.minDetectionConfidence,
  minTrackingConfidence: CONFIG.minTrackingConfidence
});

hands.onResults(onResults);

let drawingMode = 'point';

const modePointButton = document.getElementById('modePoint');
const modeLineButton = document.getElementById('modeLine');
const modeFaceButton = document.getElementById('modeFace');

function resetTempState() {
  if (tempMarker) {
    map.remove(tempMarker);
    tempMarker = null;
  }
  tempLngLat = null;

  // ✅ 确保切换模式时将当前线/面加入数组
  if (polyline) {
    if (drawingMode === 'line' && path.length >= 1) {
      polylines.push(polyline);
    }
    polyline = null;
  }

  if (polygon) {
    if (drawingMode === 'face' && path.length > 2) {
      polygons.push(polygon);
    }
    polygon = null;
  }

  path = [];
}

/** 移除临时标记点 */
function removeTempMarker() {
  if (tempMarker) {
    map.remove(tempMarker);
    tempMarker = null;
  }
}

/** 显示临时标记点（半透明预览） */
function showTempMarker(lngLat) {
  removeTempMarker();
  tempMarker = new AMap.Marker({
    position: lngLat,
    icon: CONFIG.markerIcon,
    offset: new AMap.Pixel(CONFIG.markerOffsetX, CONFIG.markerOffsetY),
    opacity: CONFIG.tempMarkerOpacity
  });
  map.add(tempMarker);
  tempLngLat = lngLat;
}

/** 添加永久点标记 */
function addPoint(lngLat) {
  removeTempMarker();
  const marker = new AMap.Marker({
    position: lngLat,
    icon: CONFIG.markerIcon,
    offset: new AMap.Pixel(CONFIG.markerOffsetX, CONFIG.markerOffsetY)
  });
  map.add(marker);
  markers.push(marker);
  tempLngLat = null;
}

/** 添加线顶点 */
function addLineVertex(lngLat) {
  removeTempMarker();
  path.push([lngLat.lng, lngLat.lat]);
  if (!polyline) {
    polyline = new AMap.Polyline({
      path: path,
      strokeColor: CONFIG.lineStrokeColor,
      strokeWeight: CONFIG.lineStrokeWeight
    });
    map.add(polyline);
    polylines.push(polyline);
  } else {
    polyline.setPath(path);
  }
  tempLngLat = null;
}

/** 闭合多边形（面模式中靠近起点时调用） */
function closePolygon() {
  if (polygon) polygons.push(polygon);
  if (polyline && path.length > 1) polylines.push(polyline);
  polygon = new AMap.Polygon({
    path: path,
    fillColor: CONFIG.faceFillColor,
    strokeColor: CONFIG.faceStrokeColor,
    strokeWeight: CONFIG.faceStrokeWeight
  });
  map.add(polygon);
  polygons.push(polygon);
  polyline = null;
  path = [];
}

/** 添加面顶点 */
function addFaceVertex(lngLat) {
  removeTempMarker();
  if (path.length === 0) {
    path = [[lngLat.lng, lngLat.lat]];
  } else {
    path.push([lngLat.lng, lngLat.lat]);
  }
  if (!polygon) {
    polygon = new AMap.Polygon({
      path: path,
      fillColor: CONFIG.faceFillColor,
      strokeColor: CONFIG.faceStrokeColor,
      strokeWeight: CONFIG.faceStrokeWeight
    });
    map.add(polygon);
    polygons.push(polygon);
  } else {
    polygon.setPath(path);
  }
  if (!polyline) {
    polyline = new AMap.Polyline({
      path: path,
      strokeColor: CONFIG.lineStrokeColor,
      strokeWeight: CONFIG.lineStrokeWeight
    });
    map.add(polyline);
    polylines.push(polyline);
  } else {
    polyline.setPath(path);
  }
  tempLngLat = null;
}

/** 判断是否接近起始点（可闭合多边形） */
function isNearStartPoint(lngLat, rectWidth) {
  if (path.length <= 2) return false;
  const startPoint = path[0];
  const startPixel = map.lngLatToContainer(new AMap.LngLat(startPoint[0], startPoint[1]));
  const currentPixel = map.lngLatToContainer(lngLat);
  const pixelDistance = Math.sqrt(
    Math.pow(startPixel.x - currentPixel.x, 2) + Math.pow(startPixel.y - currentPixel.y, 2)
  );
  return pixelDistance < CONFIG.faceCloseDistance * rectWidth;
}

function setActiveButton(activeButton) {
  [modePointButton, modeLineButton, modeFaceButton].forEach(button => {
    button.classList.remove('active');
  });
  activeButton.classList.add('active');
}

modePointButton.addEventListener('click', () => {
  drawingMode = 'point';
  resetTempState();
  setActiveButton(modePointButton);
  statusText.textContent = '模式切换：绘制点';
});

modeLineButton.addEventListener('click', () => {
  drawingMode = 'line';
  resetTempState();
  setActiveButton(modeLineButton);
  statusText.textContent = '模式切换：绘制线';
});

modeFaceButton.addEventListener('click', () => {
  drawingMode = 'face';
  resetTempState();
  setActiveButton(modeFaceButton);
  statusText.textContent = '模式切换：绘制面';
});

toggleGestureButton.addEventListener('click', () => {
  gestureEnabled = !gestureEnabled;
  statusText.textContent = gestureEnabled ? '手势识别已开启' : '手势识别已关闭';
  statusIndicator.style.backgroundColor = gestureEnabled ? 'rgb(18, 236, 18)' : '#F44336';
  if (!gestureEnabled && currentStream) {
    video.pause();
  } else if (gestureEnabled && currentStream) {
    video.play();
    requestAnimationFrame(processVideo);
  }
});

async function checkCameraPermission() {
  if (!navigator.permissions || !navigator.permissions.query) {
    permissionMessage.textContent = '请点击“启动摄像头”以授予权限。';
    return 'unknown';
  }
  try {
    const permissionStatus = await navigator.permissions.query({ name: 'camera' });
    return permissionStatus.state; // 'granted', 'denied', 'prompt'
  } catch (err) {
    console.error('Permission query error:', err);
    return 'unknown';
  }
}

async function setupCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    statusText.textContent = '浏览器不支持 getUserMedia API';
    statusIndicator.style.backgroundColor = '#F44336';
    cameraPrompt.style.display = 'flex';
    permissionMessage.textContent = '浏览器不支持摄像头访问';
    startCameraButton.style.display = 'none';
    console.error('getUserMedia not supported');
    return;
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  const videoDevices = devices.filter(device => device.kind === 'videoinput');
  console.log('Available video devices:', videoDevices);

  if (videoDevices.length === 0) {
    statusText.textContent = '未检测到摄像头';
    statusIndicator.style.backgroundColor = '#F44336';
    cameraPrompt.style.display = 'flex';
    permissionMessage.textContent = '未检测到摄像头，请检查设备连接';
    startCameraButton.style.display = 'none';
    console.error('No video devices found');
    return;
  }

  videoDevices.forEach((device, index) => {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.text = device.label || `摄像头 ${index + 1}`;
    cameraSelect.appendChild(option);
  });

  startCamera(videoDevices[0].deviceId);

  cameraSelect.addEventListener('change', () => {
    if (currentStream) {
      currentStream.getTracks().forEach(track => track.stop());
    }
    startCamera(cameraSelect.value);
  });
}

function startCamera(deviceId) {
  const constraints = {
    video: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 30 }
    }
  };
  navigator.mediaDevices.getUserMedia(constraints).then(stream => {
    currentStream = stream;
    video.srcObject = stream;
    video.addEventListener('loadeddata', () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      statusText.textContent = '摄像头已启动';
      statusIndicator.style.backgroundColor = 'rgb(18, 236, 18)';
      cameraPrompt.style.display = 'none';
      if (gestureEnabled) {
        requestAnimationFrame(processVideo);
      }
    });
  }).catch(err => {
    let errorMessage = '摄像头启动失败';
    if (window.location.protocol === 'file:') {
      errorMessage = '错误：请通过本地服务器运行，file:// 不支持摄像头';
    } else if (err.name === 'NotAllowedError') {
      errorMessage = '摄像头权限被拒绝，请在浏览器设置中允许摄像头访问';
      permissionGuide.style.display = 'block';
    } else if (err.name === 'NotFoundError') {
      errorMessage = '未找到摄像头设备，请检查摄像头是否连接';
    } else if (err.name === 'NotReadableError') {
      errorMessage = '摄像头被其他应用程序占用，请关闭其他使用摄像头的程序';
    } else if (err.name === 'OverconstrainedError') {
      errorMessage = `摄像头约束错误：${err.constraint} 不被支持`;
    } else {
      errorMessage = `摄像头启动失败：${err.message}`;
    }
    statusText.textContent = errorMessage;
    statusIndicator.style.backgroundColor = '#F44336';
    cameraPrompt.style.display = 'flex';
    permissionMessage.textContent = errorMessage;
    console.error('getUserMedia error:', err.name, err.message, err.constraint);
  });
}

async function processVideo() {
  if (!gestureEnabled) return;
  await hands.send({ image: video });
  requestAnimationFrame(processVideo);
}

function detectGesture(landmarks) {
  const wrist = landmarks[0]; // 手腕
  const thumbTip = landmarks[4]; // 拇指尖
  const indexTip = landmarks[8]; // 食指尖
  const middleTip = landmarks[12]; // 中指尖
  const ringTip = landmarks[16]; // 无名指尖
  const littleTip = landmarks[20]; // 小指尖

  const distance = (point1, point2) => {
    const dx = point1.x - point2.x;
    const dy = point1.y - point2.y;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // 计算食指长度（手腕到食指尖）作为参考
  const indexFingerLength = distance(wrist, indexTip);
  if (indexFingerLength === 0) {
    return 'move'; // 避免除零错误
  }

  // 计算关键距离
  const thumbIndexDistance = distance(thumbTip, indexTip);
  const middleRingLittleDistance = Math.max(
    distance(middleTip, ringTip),
    distance(ringTip, littleTip),
    distance(middleTip, littleTip)
  );

  // 归一化距离（除以食指长度）
  const thumbIndexRatio = thumbIndexDistance / indexFingerLength;
  const middleRingLittleRatio = middleRingLittleDistance / indexFingerLength;

  // 手势判断
  if (middleRingLittleRatio < CONFIG.middleRingLittleRatio) {
    if (thumbIndexRatio < CONFIG.thumbIndexPinchRatio) {
      return 'pinch';
    } else if (thumbIndexRatio > CONFIG.thumbIndexSpreadRatio) {
      return 'spread';
    }
  }
  return 'move';
}

// 平滑缩放动画函数
function smoothZoom(targetZoom, center, duration) {
  if (isZooming) return; // 防止动画重叠
  isZooming = true;

  const startZoom = map.getZoom();
  const startTime = performance.now();

  function animate(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1); // 0 to 1
    const ease = progress * (2 - progress); // Ease-in-out
    const currentZoom = startZoom + (targetZoom - startZoom) * ease;

    map.setZoomAndCenter(currentZoom, center, true); // 立即更新，依赖动画帧

    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      isZooming = false; // 动画结束
    }
  }

  requestAnimationFrame(animate);
}

function updateMap(gesture, landmarks) {
  const indexTip = landmarks[8];
  const middleTip = landmarks[12];

  const rect = video.getBoundingClientRect();
  const realX = (1 - indexTip.x) * rect.width;
  const realY = indexTip.y * rect.height;
  const lngLat = map.containerToLngLat(new AMap.Pixel(realX, realY));

  const dx = indexTip.x - middleTip.x;
  const dy = indexTip.y - middleTip.y;
  const pointDistance = Math.sqrt(dx * dx + dy * dy);
  const now = Date.now();
  const canConfirm = pointDistance > CONFIG.pointDistanceOpen && tempLngLat && now - lastPointTime > CONFIG.pointInterval;

  if (drawingMode === 'point') {
    if (pointDistance < CONFIG.pointDistanceClose) {
      showTempMarker(lngLat);
      statusText.textContent = '准备放置点，请张开食指和中指';
    } else if (canConfirm) {
      addPoint(tempLngLat);
      lastPointTime = now;
      statusText.textContent = '点已放置，继续放置下一个点';
    }
  } else if (drawingMode === 'line') {
    if (pointDistance < CONFIG.pointDistanceClose) {
      showTempMarker(lngLat);
      statusText.textContent = '准备添加线顶点，请张开食指和中指';
    } else if (canConfirm) {
      addLineVertex(tempLngLat);
      lastPointTime = now;
      statusText.textContent = path.length === 1 ? '线起点已添加，继续添加下一个点' : '线顶点已添加，继续添加或切换模式';
    }
  } else if (drawingMode === 'face') {
    if (pointDistance < CONFIG.pointDistanceClose) {
      if (isNearStartPoint(lngLat, rect.width)) {
        removeTempMarker();
        closePolygon();
        statusText.textContent = '多边形已闭合，开始新的多边形';
      } else {
        showTempMarker(lngLat);
        statusText.textContent = '准备添加面顶点，请张开食指和中指';
      }
    } else if (canConfirm) {
      addFaceVertex(tempLngLat);
      lastPointTime = now;
      statusText.textContent = '面顶点已添加，继续添加下一个';
    }
  }

  if (gesture === 'pinch' && now - lastZoomTime > CONFIG.zoomInterval && !isZooming) {
    const targetZoom = Math.max(3, map.getZoom() - CONFIG.zoomStep);
    smoothZoom(targetZoom, lngLat, CONFIG.zoomAnimationDuration);
    lastZoomTime = now;
    statusText.textContent = '地图缩小';
  } else if (gesture === 'spread' && now - lastZoomTime > CONFIG.zoomInterval && !isZooming) {
    const targetZoom = Math.min(20, map.getZoom() + CONFIG.zoomStep);
    smoothZoom(targetZoom, lngLat, CONFIG.zoomAnimationDuration);
    lastZoomTime = now;
    statusText.textContent = '地图放大';
  }
}

function onResults(results) {
  ensureHandOverlay();
  /* 确保 canvas 有有效尺寸：优先使用地图尺寸，与 overlay 显示区域一致 */
  const mapSize = map.getSize && map.getSize();
  const w = (mapSize && mapSize.width) || video.videoWidth || 640;
  const h = (mapSize && mapSize.height) || video.videoHeight || 480;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!gestureEnabled) {
    statusText.textContent = '手势识别已关闭';
    return;
  }
  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    const landmarks = results.multiHandLandmarks[0];
    const gesture = detectGesture(landmarks);
    updateMap(gesture, landmarks);
    if (canvas.width > 0 && canvas.height > 0) {
      drawHandLandmarks(landmarks);
    }
  } else {
    statusText.textContent = '未检测到手部';
  }
}

function drawHandLandmarks(landmarks) {
  const handConnections = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [0, 9], [9, 10], [10, 11], [11, 12],
    [0, 13], [13, 14], [14, 15], [15, 16],
    [0, 17], [17, 18], [18, 19], [19, 20]
  ];

  landmarks.forEach((landmark, index) => {
    const x = (1 - landmark.x) * canvas.width;
    const y = landmark.y * canvas.height;
    ctx.beginPath();
    ctx.arc(x, y, CONFIG.landmarkPointSize, 0, 2 * Math.PI);
    ctx.fillStyle = CONFIG.landmarkPointColor;
    ctx.fill();
  });

  handConnections.forEach(connection => {
    const [start, end] = connection;
    const startLandmark = landmarks[start];
    const endLandmark = landmarks[end];

    const startX = (1 - startLandmark.x) * canvas.width;
    const startY = startLandmark.y * canvas.height;
    const endX = (1 - endLandmark.x) * canvas.width;
    const endY = endLandmark.y * canvas.height;

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.strokeStyle = CONFIG.connectionLineColor;
    ctx.lineWidth = CONFIG.connectionLineWidth;
    ctx.stroke();
  });
}


async function takeScreenshot() {
  console.log('[截图] 开始优化版截图流程');

  try {
    // 基础检查
    if (!map || !document.getElementById('map')) {
      throw new Error('地图未初始化');
    }

    // 等待地图完全渲染
    console.log('[截图] 等待地图准备就绪');
    await waitForMapRendered();

    // 获取地图容器和尺寸
    const container = map.getContainer();
    const width = container.offsetWidth;
    const height = container.offsetHeight;

    // 增强版Canvas查找逻辑
    let mainCanvas = container.querySelector('canvas.amap-layers');
    if (!mainCanvas) {
      // 备用查找方案
      mainCanvas = container.querySelector('canvas');
      if (!mainCanvas) {
        // 最终回退方案：等待并重试
        await new Promise(resolve => setTimeout(resolve, 300));
        mainCanvas = container.querySelector('canvas');
        if (!mainCanvas) {
          throw new Error('找不到地图画布元素，请确保地图已完全加载');
        }
      }
    }

    // 创建目标Canvas
    const resultCanvas = document.createElement('canvas');
    resultCanvas.width = width;
    resultCanvas.height = height;
    const ctx = resultCanvas.getContext('2d');

    // 1. 可靠底图绘制流程
    let retryCount = 0;
    const maxRetries = 2;

    const drawBaseMap = async () => {
      // 确保画布有效
      if (mainCanvas.width === 0 || mainCanvas.height === 0) {
        console.warn('地图画布尺寸异常，强制重绘');
        map.render();
        await new Promise(resolve => setTimeout(resolve, 150));
      }

      // 首次绘制
      ctx.drawImage(mainCanvas, 0, 0, width, height);

      // 验证绘制结果（检查左上角10x10区域）
      const imageData = ctx.getImageData(0, 0, 10, 10).data;
      const isEmpty = imageData.every(val => val === 0);

      if (isEmpty && retryCount < maxRetries) {
        retryCount++;
        console.warn(`底图绘制结果为空，第${retryCount}次重试`);
        map.render();
        await new Promise(resolve => setTimeout(resolve, 100 * retryCount));
        return false;
      }
      return true;
    };

    // 执行绘制流程
    while (!(await drawBaseMap()) && retryCount <= maxRetries) {
      // 循环直到绘制成功或达到最大重试次数
    }

    // 最终验证
    if (retryCount >= maxRetries) {
      console.warn('达到最大重试次数，使用空白底图继续');
    }

    // 2. 绘制覆盖物（使用脚本维护的 markers/polylines/polygons）
    console.log(`[截图] 绘制${markers.length}个标记点, ${polylines.length}条线, ${polygons.length}个面`);

    const toLngLat = (p) => (p && (p.lng !== undefined)) ? p : new AMap.LngLat(p[0], p[1]);

    // 绘制线和面
    [...polylines, ...polygons].forEach(overlay => {
      try {
        const path = overlay.getPath ? overlay.getPath() : [];
        if (!path || path.length === 0) return;
        ctx.beginPath();
        const p0 = map.lngLatToContainer(toLngLat(path[0]));
        ctx.moveTo(p0.x, p0.y);
        for (let i = 1; i < path.length; i++) {
          const px = map.lngLatToContainer(toLngLat(path[i]));
          ctx.lineTo(px.x, px.y);
        }
        if (overlay instanceof AMap.Polygon) {
          ctx.closePath();
          ctx.fillStyle = (overlay.getOptions && overlay.getOptions().fillColor) || 'rgba(0,170,255,0.3)';
          ctx.fill();
        }
        ctx.strokeStyle = (overlay.getOptions && overlay.getOptions().strokeColor) || '#00aaff';
        ctx.lineWidth = (overlay.getOptions && overlay.getOptions().strokeWeight) || 2;
        ctx.stroke();
      } catch (err) {
        console.warn('线/面绘制失败:', err);
      }
    });

    // 绘制标记点
    markers.forEach(m => {
      try {
        const pos = m.getPosition ? m.getPosition() : null;
        if (!pos) return;
        const p = map.lngLatToContainer(pos);
        ctx.fillStyle = '#3388ff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
        ctx.fill();
      } catch (err) {
        console.warn('标记点绘制失败:', err);
      }
    });

    console.log('[截图] 截图成功');
    return resultCanvas;

  } catch (err) {
    console.error('[截图] 截图失败:', err);
    throw err;
  }
}

function drawPath(ctx, path, options, isPolygon) {
  if (!path || path.length === 0) return;

  ctx.beginPath();
  const first = map.lngLatToContainer(new AMap.LngLat(path[0].lng, path[0].lat));
  ctx.moveTo(first.x, first.y);

  for (let i = 1; i < path.length; i++) {
    const point = map.lngLatToContainer(new AMap.LngLat(path[i].lng, path[i].lat));
    ctx.lineTo(point.x, point.y);
  }

  if (isPolygon) {
    ctx.closePath();
    if (options.fillColor) {
      ctx.fillStyle = options.fillColor;
      ctx.fill();
    }
  }

  ctx.strokeStyle = options.strokeColor || '#00aaff';
  ctx.lineWidth = options.strokeWeight || 2;
  ctx.stroke();
}

function waitForMapRendered() {
  return new Promise((resolve) => {
    console.log('[截图] 检查渲染状态');
    const canvasReady = !!document.querySelector('#map canvas');
    if (canvasReady && map.getZoom && map.getCenter) {
      map.render && map.render();
      setTimeout(resolve, 400);
      return;
    }
    let attempts = 0;
    const check = () => {
      attempts++;
      const ready = !!document.querySelector('#map canvas');
      if (ready || attempts >= 5) {
        map.render && map.render();
        setTimeout(resolve, 400);
        return;
      }
      setTimeout(check, 300);
    };
    setTimeout(check, 300);
  });
}



// 将 dataURL 转换为 Blob
function dataURLtoBlob(dataURL) {
  const arr = dataURL.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  const n = bstr.length;
  const u8arr = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    u8arr[i] = bstr.charCodeAt(i);
  }

  return new Blob([u8arr], { type: mime });
}

// 获取 GeoJSON 数据
function getGeoJsonData() {
  const features = [];

  // 添加 Marker（点）
  markers.forEach(marker => {
    const position = marker.getPosition();
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [position.lng, position.lat]
      },
      properties: {
        type: 'marker'
      }
    });
  });

  // 添加 Polyline（线）
  polylines.forEach(polyline => {
    const path = polyline.getPath(); // 获取路径坐标点
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: path.map(p => [p.lng, p.lat])
      },
      properties: {
        type: 'polyline'
      }
    });
  });

  // 添加 Polygon（面）
  polygons.forEach(polygon => {
    const path = polygon.getPath(); // 获取多边形顶点
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [path.map(p => [p.lng, p.lat])]
      },
      properties: {
        type: 'polygon'
      }
    });
  });

  return {
    type: 'FeatureCollection',
    features
  };
}

// 显示提示信息
function showFlashMessage(message, isSuccess = false) {
  // 创建消息元素
  const flashElement = document.createElement('div');
  flashElement.className = `flash-message ${isSuccess ? 'success' : 'error'}`;
  flashElement.textContent = message;
  document.body.appendChild(flashElement);

  // 3秒后自动移除提示
  setTimeout(() => {
    if (document.body.contains(flashElement)) {
      document.body.removeChild(flashElement);
    }
  }, 3000);
}
// 保存图片到本地
function saveImage(dataURL, filename) {
  const link = document.createElement('a');
  link.href = dataURL;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
// 静态原型：不上传服务器，仅保存到本地
function uploadToServer(mapInfo) {
  takeScreenshot()
    .then((canvas) => {
      const dataURL = canvas.toDataURL('image/png');
      const filename = (mapInfo && mapInfo.mapTitle) ? mapInfo.mapTitle + '.png' : 'screenshot.png';
      saveImage(dataURL, filename);
      const geojsonData = getGeoJsonData();
      const geojsonBlob = new Blob([JSON.stringify(geojsonData, null, 2)], { type: 'application/json' });
      const geojsonUrl = URL.createObjectURL(geojsonBlob);
      const geojsonLink = document.createElement('a');
      geojsonLink.href = geojsonUrl;
      geojsonLink.download = (mapInfo && mapInfo.mapTitle) ? mapInfo.mapTitle + '.geojson' : 'map.geojson';
      geojsonLink.click();
      URL.revokeObjectURL(geojsonUrl);
      showFlashMessage('已保存图片和 GeoJSON 到本地', true);
    })
    .catch((error) => {
      console.error('保存失败:', error);
      showFlashMessage('保存失败: ' + error.message);
    });
}

// 显示保存到服务器弹窗
function showSaveToServerModal() {
  console.log('showSaveToServerModal called');

  const modal = document.getElementById('saveToServerModal');
  if (!modal) {
    console.error('Modal element not found');
    return;
  }

  // 获取或创建遮罩层
  let overlay = document.getElementById('modalOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'modalOverlay';
    overlay.className = 'save-modal-overlay';
    document.body.appendChild(overlay);
  }

  // 设置遮罩层显示并置于底层
  overlay.style.display = 'block';
  overlay.style.zIndex = '1001'; // 遮罩层 z-index 为 1001

  // 设置弹窗显示并置于最上层
  modal.style.display = 'block';
  modal.style.zIndex = '1002'; // 弹窗 z-index 为 1002
  modal.style.pointerEvents = 'auto';

  setupMapClickListener();
}

// 设置地图点击监听器
function setupMapClickListener() {
  const getCoordinatesBtn = document.getElementById('getCoordinatesBtn');
  // 设置为灰色不可用状态
  getCoordinatesBtn.disabled = true;
  getCoordinatesBtn.classList.add('disabled');
  
  if (getCoordinatesBtn) {
    // 移除已有的监听器（避免重复绑定）
    const existingListener = getCoordinatesBtn.dataset.listener;
    if (existingListener) {
      getCoordinatesBtn.removeEventListener('click', handleGetCoordinatesClick);
    }

    // 添加新的监听器
    getCoordinatesBtn.addEventListener('click', handleGetCoordinatesClick);
    getCoordinatesBtn.dataset.listener = 'true';
  }
}

function handleGetCoordinatesClick() {
  // 隐藏弹窗和遮罩层
  const modal = document.getElementById('saveToServerModal');
  const overlay = document.getElementById('modalOverlay');

  if (modal) modal.style.display = 'none';
  if (overlay) overlay.style.display = 'none';

  // 获取地图容器
  const mapContainer = document.getElementById('map');
  if (!mapContainer) {
    console.error('Map container not found');
    return;
  }

  // 改变光标样式为十字
  mapContainer.style.cursor = 'crosshair';

  // 绑定一次性的地图点击事件
  const clickHandler = function (e) {
    // ✅ 使用高德地图自带的 lnglat 属性直接获取坐标
    const lngLat = e.lnglat;

    const coordinateInput = document.getElementById('mapCoordinate');
    if (coordinateInput) {
      coordinateInput.value = `(${lngLat.getLng()}, ${lngLat.getLat()})`;
    }

    // 恢复鼠标样式
    mapContainer.style.cursor = 'default';

    // 移除监听器
    map.off('click', clickHandler);

    // ✅ 重新显示弹窗和遮罩层
    if (modal) modal.style.display = 'block';
    if (overlay) overlay.style.display = 'block';
  };

  // 监听地图点击
  map.on('click', clickHandler);
}

// 关闭弹窗
function hideSaveToServerModal() {
  const modal = document.getElementById('saveToServerModal');
  const overlay = document.getElementById('modalOverlay');

  if (modal) {
    modal.style.display = 'none';
  }

  if (overlay) {
    overlay.style.display = 'none';
  }
}



// 确认保存函数（静态原型：本地保存）
function handleConfirmSave() {
  const mapTitleEl = document.getElementById('mapTitle');
  const mapTitle = mapTitleEl ? mapTitleEl.value : '';
  const mapInfo = {
    mapTitle: mapTitle || '地图',
    mapCoordinate: '',
    categories: [],
    description: '',
    mode: 'Gesture'
  };

  hideSaveToServerModal();
  uploadToServer(mapInfo);
}

// 取消按钮点击事件
function handleCancelSave() {
  hideSaveToServerModal();
}

// 在 DOM 加载完成后绑定事件监听器
document.addEventListener('DOMContentLoaded', function () {
  // 为保存按钮绑定事件（假设保存按钮是第二个 .top-bar .btn）
  const saveButton = document.querySelector('.top-bar .btn:nth-child(2)');
  if (saveButton) {
    // 移除可能存在的旧监听器
    const oldOnClick = saveButton.onclick;
    if (oldOnClick) {
      saveButton.removeEventListener('click', oldOnClick);
    }

    // 添加新监听器
    saveButton.addEventListener('click', function () {
      showSaveToServerModal();
    });
  }

  // 为确认和取消按钮绑定事件
  const confirmBtn = document.getElementById('confirmBtn');
  const cancelBtn = document.getElementById('cancelBtn');

  if (confirmBtn) {
    // 移除可能存在的旧监听器
    const oldOnClick = confirmBtn.onclick;
    if (oldOnClick) {
      confirmBtn.removeEventListener('click', oldOnClick);
    }

    confirmBtn.addEventListener('click', handleConfirmSave);
  }

  if (cancelBtn) {
    // 移除可能存在的旧监听器
    const oldOnClick = cancelBtn.onclick;
    if (oldOnClick) {
      cancelBtn.removeEventListener('click', oldOnClick);
    }

    cancelBtn.addEventListener('click', handleCancelSave);
  }
});
// 初始化权限检查
window.addEventListener('load', async () => {
  const permissionState = await checkCameraPermission();
  if (permissionState === 'granted') {
    setupCamera();
  } else if (permissionState === 'denied') {
    cameraPrompt.style.display = 'flex';
    permissionMessage.textContent = '摄像头权限被拒绝，请在浏览器设置中允许访问';
    permissionGuide.style.display = 'block';
  } else {
    cameraPrompt.style.display = 'flex';
    permissionMessage.textContent = '请点击“启动摄像头”以授予权限';
  }

  startCameraButton.addEventListener('click', () => {
    permissionGuide.style.display = 'none';
    setupCamera();
  });
});