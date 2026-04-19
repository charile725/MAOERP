"use client";

import { motion } from "framer-motion";
import AnimatedShaderBackground from "@/components/ui/animated-shader-background";

export default function Home() {
  return (
    <div className="relative min-h-screen bg-black overflow-hidden">
      {/* Aurora Shader Background */}
      <AnimatedShaderBackground />

      {/* Content overlay */}
      <div className="relative z-10 min-h-screen flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.5, filter: "blur(20px)" }}
          animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
          transition={{
            duration: 1.5,
            ease: [0.16, 1, 0.3, 1],
            delay: 0.3
          }}
        >
          <motion.h1
            className="text-6xl md:text-8xl lg:text-9xl font-bold text-center bg-clip-text text-transparent bg-gradient-to-b from-white via-white to-white/40 drop-shadow-2xl"
            initial={{ y: 50 }}
            animate={{ y: 0 }}
            transition={{
              duration: 1.2,
              ease: [0.16, 1, 0.3, 1],
              delay: 0.5
            }}
          >
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.8 }}
              className="inline-block"
            >
              瘋
            </motion.span>
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 1.0 }}
              className="inline-block"
            >
              玩
            </motion.span>
            <motion.span
              initial={{ opacity: 0, scale: 1.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 1, delay: 1.3, ease: "easeOut" }}
              className="inline-block bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-600"
            >
              ERP
            </motion.span>
          </motion.h1>
        </motion.div>

        {/* Glowing orb effect */}
        <motion.div
          className="absolute w-96 h-96 rounded-full bg-gradient-to-r from-cyan-500/20 to-purple-500/20 blur-3xl"
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 2, delay: 0.5 }}
        />
      </div>
    </div>
  );
}
