import { useEffect, useRef } from "react";
import * as THREE from "three";

const VERTEX_SHADER = `
varying vec2 vUv;
void main() {
  gl_Position = vec4(position, 1.0);
  vUv = uv;
}
`;

const FRAGMENT_SHADER = `
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
varying vec2 vUv;

const float PI = 3.1415926535897932384626433832795;
const float TAU = PI * 2.0;

void coswarp(inout vec3 trip, float warpsScale) {
  trip.xyz += warpsScale * 0.1 * cos(3.0 * trip.yzx + (u_time * 0.06));
  trip.xyz += warpsScale * 0.05 * cos(11.0 * trip.yzx + (u_time * 0.06));
  trip.xyz += warpsScale * 0.025 * cos(17.0 * trip.yzx + (u_time * 0.06));
}

void main() {
  vec2 uv = (gl_FragCoord.xy - u_resolution * 0.5) / u_resolution.yy + 0.5;

  float t = (u_time * 0.05) + length(fract((uv - 0.5) * 10.0));
  float t2 = (u_time * 0.025) + length(fract((uv - 0.5) * 20.0));

  vec2 uv2 = uv;
  vec3 w = vec3(uv.x, uv.y, 1.0);
  coswarp(w, 3.0);

  uv.x += w.r;
  uv.y += w.g;

  vec3 color = vec3(0.0, 0.5, uv2.x);
  color.r = sin(u_time * 0.05) + sin(length(uv - 0.5) * 10.0);
  color.g = sin(u_time * 0.075) + sin(length(uv - 0.5) * 20.0);

  coswarp(color, 3.0);

  color = vec3(smoothstep(color.r, sin(t2), sin(t)));

  /* --- Sparse accent color strands --- */
  vec3 accent0 = vec3(1.0, 0.42, 0.616);
  vec3 accent1 = vec3(0.639, 0.42, 1.0);
  vec3 accent2 = vec3(0.42, 0.812, 1.0);
  vec3 accent3 = vec3(0.42, 1.0, 0.616);

  float strand0 = smoothstep(0.48, 0.50, sin(w.x * 12.0 + w.y * 8.0 + u_time * 0.04));
  float strand1 = smoothstep(0.48, 0.50, sin(w.y * 14.0 - w.x * 6.0 + u_time * 0.03));
  float strand2 = smoothstep(0.48, 0.50, sin(w.x * 10.0 + w.z * 11.0 - u_time * 0.05));
  float strand3 = smoothstep(0.48, 0.50, sin(w.z * 13.0 - w.y * 9.0 + u_time * 0.035));

  float si = 0.08;
  color = mix(color, accent0 * color.r * 2.0, strand0 * si);
  color = mix(color, accent1 * color.r * 2.0, strand1 * si);
  color = mix(color, accent2 * color.r * 2.0, strand2 * si);
  color = mix(color, accent3 * color.r * 2.0, strand3 * si);

  /* --- Subtle ambient wash --- */
  /* Compress contrast so waves are gentle, not sharp */
  color = mix(vec3(0.5), color, 0.25);
  /* Overall brightness */
  color *= 0.09;
  /* Cool tint */
  color.r *= 0.6;
  color.g *= 0.75;
  color.b *= 1.15;
  /* Vignette */
  vec2 vigUv = (gl_FragCoord.xy / u_resolution) - 0.5;
  float vignette = 1.0 - dot(vigUv, vigUv) * 1.5;
  color *= clamp(vignette, 0.0, 1.0);

  float lum = (color.r + color.g + color.b) / 3.0;
  float a = smoothstep(0.01, 0.06, lum);
  gl_FragColor = vec4(color, a);
}
`;

export default function ShaderBackground() {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const clock = new THREE.Clock();
    const camera = new THREE.Camera();
    camera.position.z = 1;

    const scene = new THREE.Scene();
    const geometry = new THREE.PlaneGeometry(2, 2);

    const uniforms = {
      u_time: { value: 1.0 },
      u_resolution: { value: new THREE.Vector2() },
    };

    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
    });

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    const renderer = new THREE.WebGLRenderer({ alpha: true, premultipliedAlpha: false });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const onResize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      uniforms.u_resolution.value.x = renderer.domElement.width;
      uniforms.u_resolution.value.y = renderer.domElement.height;
    };
    onResize();
    window.addEventListener("resize", onResize);

    let rafId;
    const animate = () => {
      uniforms.u_time.value = clock.getElapsedTime();
      renderer.render(scene, camera);
      rafId = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      material.dispose();
      geometry.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return <div ref={containerRef} className="shader-bg" />;
}
