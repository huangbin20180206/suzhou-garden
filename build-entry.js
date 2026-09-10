// 打包入口：把 three 与所有用到的 addons 汇成一个本地模块，
// 发布后页面不再依赖任何外部 CDN（大陆网络下 unpkg/jsDelivr 不稳定）
export * as THREE from 'three';
export { OrbitControls }    from 'three/examples/jsm/controls/OrbitControls.js';
export { EffectComposer }   from 'three/examples/jsm/postprocessing/EffectComposer.js';
export { RenderPass }       from 'three/examples/jsm/postprocessing/RenderPass.js';
export { UnrealBloomPass }  from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
export { ShaderPass }       from 'three/examples/jsm/postprocessing/ShaderPass.js';
export { OutputPass }       from 'three/examples/jsm/postprocessing/OutputPass.js';
export { GLTFLoader }       from 'three/examples/jsm/loaders/GLTFLoader.js';
export { Reflector }        from 'three/examples/jsm/objects/Reflector.js';
export { mergeGeometries }  from 'three/examples/jsm/utils/BufferGeometryUtils.js';
