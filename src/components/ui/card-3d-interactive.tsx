/* eslint-disable @next/next/no-img-element */
"use client";

import React, { useRef, useState, useEffect } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { Sparkles, ShieldCheck, RotateCw } from "lucide-react";

interface Card3DInteractiveProps {
  imageSrc: string;
  cardName: string;
  brand: string;
  accentColor?: string;
  region?: string;
  discountPercentage?: number;
  className?: string;
  showHangerSlot?: boolean;
}

export function Card3DInteractive({
  imageSrc,
  cardName,
  brand,
  accentColor = "#3b82f6",
  region,
  discountPercentage,
  className = "",
  showHangerSlot = false,
}: Card3DInteractiveProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);

  // Normalized mouse position: -1 (left/top) to 1 (right/bottom)
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  // Spring physics for buttery-smooth responsiveness
  const springConfig = { damping: 24, stiffness: 220, mass: 0.55 };
  const smoothX = useSpring(mouseX, springConfig);
  const smoothY = useSpring(mouseY, springConfig);

  // 3D rotations based on mouse
  const rotateX = useTransform(smoothY, [-1, 1], [15, -15]);
  const rotateY = useTransform(smoothX, [-1, 1], [-16, 16]);

  // Dynamic light & specular sheen coordinates (0% to 100%)
  const sheenX = useTransform(smoothX, [-1, 1], [15, 85]);
  const sheenY = useTransform(smoothY, [-1, 1], [15, 85]);

  // Holographic reflection angle
  const holoAngle = useTransform(smoothX, [-1, 1], [45, 225]);

  // Ambient gentle float when autoRotate is enabled or when not hovered
  useEffect(() => {
    let frameId: number;
    const startTime = Date.now();

    if (autoRotate) {
      const loop = () => {
        const elapsed = (Date.now() - startTime) / 1000;
        // Smooth lissajous figure-8 float
        const xVal = Math.sin(elapsed * 1.5) * 0.75;
        const yVal = Math.cos(elapsed * 1.1) * 0.55;
        mouseX.set(xVal);
        mouseY.set(yVal);
        frameId = requestAnimationFrame(loop);
      };
      frameId = requestAnimationFrame(loop);
    }

    return () => {
      if (frameId) cancelAnimationFrame(frameId);
    };
  }, [autoRotate, mouseX, mouseY]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (autoRotate) setAutoRotate(false);
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Convert to -1 to 1 range
    const normX = (x / rect.width) * 2 - 1;
    const normY = (y / rect.height) * 2 - 1;

    mouseX.set(normX);
    mouseY.set(normY);
  };

  const handleMouseEnter = () => {
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    if (!autoRotate) {
      mouseX.set(0);
      mouseY.set(0);
    }
  };

  // Touch support for mobile devices
  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!containerRef.current || e.touches.length === 0) return;
    const touch = e.touches[0];
    const rect = containerRef.current.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;
    const normX = Math.max(-1, Math.min(1, (x / rect.width) * 2 - 1));
    const normY = Math.max(-1, Math.min(1, (y / rect.height) * 2 - 1));
    mouseX.set(normX);
    mouseY.set(normY);
  };

  return (
    <div className={`relative flex flex-col items-center select-none ${className}`}>
      {/* 3D Perspective Container */}
      <div
        ref={containerRef}
        onMouseMove={handleMouseMove}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleMouseLeave}
        style={{ perspective: 1200 }}
        className="relative w-full max-w-[340px] sm:max-w-[380px] cursor-grab active:cursor-grabbing p-4"
      >
        {/* Dynamic Ambient Glow behind the card */}
        <motion.div
          animate={{
            scale: isHovered ? 1.15 : 1,
            opacity: isHovered ? 0.45 : 0.25,
          }}
          transition={{ duration: 0.4 }}
          className="absolute inset-4 -z-10 rounded-[36px] blur-3xl pointer-events-none transition-colors duration-500"
          style={{ background: accentColor }}
        />

        {/* 3D Card Shell */}
        <motion.div
          initial={{ opacity: 0, scale: 0.88, rotateX: 22, rotateY: -18, y: 35 }}
          animate={{
            opacity: 1,
            scale: isHovered ? 1.04 : 1,
            y: isHovered ? -8 : 0,
          }}
          transition={{
            type: "spring",
            damping: 20,
            stiffness: 180,
            duration: 0.8,
          }}
          style={{
            rotateX,
            rotateY,
            transformStyle: "preserve-3d",
            willChange: "transform",
          }}
          className="relative rounded-[28px] sm:rounded-[32px] p-2 sm:p-2.5 bg-gradient-to-b from-slate-800/90 via-slate-900/95 to-slate-950 border border-white/20 shadow-2xl overflow-hidden backdrop-blur-xl"
        >
          {/* Subtle Outer Cardboard Bevel Rim */}
          <div className="absolute inset-0 rounded-[28px] sm:rounded-[32px] border border-white/20 pointer-events-none" />

          {/* Authentic Retail Packaging Hanger Hole (Euro-Slot / Sombrero Cutout) */}
          {showHangerSlot && (
            <div
              style={{ transform: "translateZ(20px)" }}
              className="relative z-30 pt-1 pb-2 flex justify-center items-center pointer-events-none"
            >
              <div className="w-16 h-4 sm:w-20 sm:h-4.5 rounded-full bg-slate-950/90 border border-white/25 shadow-inner flex items-center justify-center">
                <div className="w-6 h-1 rounded-full bg-slate-800" />
              </div>
            </div>
          )}

          {/* Card Packaging Main Image Container */}
          <div
            style={{ transform: "translateZ(10px)" }}
            className="relative z-10 w-full rounded-2xl overflow-hidden bg-slate-950 flex items-center justify-center p-2 border border-white/10"
          >
            {/* The Authentic Physical Card Image */}
            <img
              src={imageSrc}
              alt={cardName}
              draggable={false}
              className="w-full max-h-[380px] sm:max-h-[440px] object-contain rounded-xl drop-shadow-[0_20px_35px_rgba(0,0,0,0.85)] pointer-events-none"
            />

            {/* Specular Light Flare / Reflection Sheen Overlay */}
            <motion.div
              style={{
                background: useTransform(
                  [sheenX, sheenY],
                  ([x, y]) =>
                    `radial-gradient(circle 380px at ${x}% ${y}%, rgba(255, 255, 255, 0.42) 0%, rgba(255, 255, 255, 0.12) 30%, transparent 70%)`
                ),
              }}
              className="absolute inset-0 pointer-events-none mix-blend-overlay z-20"
            />

            {/* Holographic Iridescent Foil Ribbon Reflection */}
            <motion.div
              style={{
                opacity: isHovered ? 0.35 : 0.18,
                background: useTransform(
                  holoAngle,
                  (angle) =>
                    `linear-gradient(${angle}deg, transparent 20%, rgba(255, 0, 128, 0.35) 35%, rgba(0, 229, 255, 0.4) 50%, rgba(255, 215, 0, 0.35) 65%, transparent 80%)`
                ),
              }}
              className="absolute inset-0 pointer-events-none mix-blend-color-dodge z-25 transition-opacity duration-300"
            />

            {/* Initial Entrance Light Sweep Animation */}
            <motion.div
              initial={{ x: "-120%", opacity: 0.8 }}
              animate={{ x: "220%", opacity: 0 }}
              transition={{ delay: 0.4, duration: 1.2, ease: "easeInOut" }}
              className="absolute inset-y-0 w-32 -skew-x-25 bg-gradient-to-r from-transparent via-white/30 to-transparent pointer-events-none z-30"
            />
          </div>

          {/* Floating 3D Elements that pop out in Z space */}
          {/* Top Left: Authentic Retail Voucher Hologram Stamp */}
          <div
            style={{ transform: "translateZ(35px)" }}
            className="absolute top-7 left-6 z-30 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-950/85 backdrop-blur-md border border-white/25 text-[10px] font-black uppercase tracking-wider text-slate-200 shadow-xl pointer-events-none"
          >
            <ShieldCheck className="w-3 h-3 text-emerald-400" />
            <span>Retail Oficial</span>
          </div>

          {/* Top Right: Region Badge */}
          {region && (
            <div
              style={{ transform: "translateZ(35px)" }}
              className="absolute top-7 right-6 z-30 px-2.5 py-1 rounded-full bg-slate-950/85 backdrop-blur-md border border-white/25 text-[10px] font-black uppercase tracking-wider text-sky-300 shadow-xl pointer-events-none"
            >
              {region}
            </div>
          )}

          {/* Bottom Right: Discount Flag if present */}
          {discountPercentage && discountPercentage > 0 && (
            <div
              style={{ transform: "translateZ(38px)" }}
              className="absolute bottom-6 right-6 z-30 px-3 py-1 rounded-xl bg-emerald-500 text-slate-950 text-xs font-black uppercase tracking-wider shadow-xl shadow-emerald-500/30 pointer-events-none"
            >
              -{discountPercentage}%
            </div>
          )}

          {/* Card Bottom Bar Details */}
          <div
            style={{ transform: "translateZ(25px)" }}
            className="relative z-20 mt-2 px-3 py-1.5 flex items-center justify-between text-[11px] text-slate-300 pointer-events-none"
          >
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-semibold text-white">{brand}</span>
            </div>
            <span className="text-[10px] text-slate-400 font-mono tracking-tight">
              DIGITAL VOUCHER · C2P
            </span>
          </div>
        </motion.div>
      </div>

      {/* Tactile Interaction Hint & Controls Bar */}
      <div className="mt-4 flex items-center gap-2.5 px-4 py-2 rounded-2xl bg-slate-900/70 border border-white/10 text-xs text-slate-300 backdrop-blur-md shadow-lg">
        <Sparkles className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
        <span className="font-medium text-slate-300">
          Mueve el cursor para inclinar en 3D
        </span>

        <span className="text-slate-600">|</span>

        <button
          type="button"
          onClick={() => setAutoRotate(!autoRotate)}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-xl text-[11px] font-bold transition-all ${
            autoRotate
              ? "bg-sky-500 text-slate-950 shadow-md shadow-sky-500/25"
              : "bg-white/5 hover:bg-white/10 text-slate-300"
          }`}
          title="Activar/desactivar flotación automática"
        >
          <RotateCw className={`w-3 h-3 ${autoRotate ? "animate-spin" : ""}`} />
          <span>{autoRotate ? "Pausar" : "Auto-Giro"}</span>
        </button>
      </div>
    </div>
  );
}
