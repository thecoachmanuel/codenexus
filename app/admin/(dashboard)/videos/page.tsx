"use client";

import { useState, useRef, useEffect } from "react";
import { Loader2, Video, Play, Download, Wand2, Type } from "lucide-react";
import { toast } from "sonner";

interface Scene {
  narration: string;
  imagePrompt: string;
}

interface ScriptData {
  title: string;
  scenes: Scene[];
}

export default function AdminVideosPage() {
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [scriptData, setScriptData] = useState<ScriptData | null>(null);
  
  // Player state
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSceneIndex, setCurrentSceneIndex] = useState(0);
  const [captionWord, setCaptionWord] = useState("");
  
  // Animation Engine State
  const animationFrameRef = useRef<number>(0);
  const playbackStateRef = useRef({
    sceneIndex: 0,
    word: "",
    startTime: 0,
    isPlaying: false
  });
  
  // Media Recorder
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const [isRecording, setIsRecording] = useState(false);

  // Loaded images cache
  const imagesCache = useRef<Record<number, HTMLImageElement>>({});

  const generateScript = async () => {
    if (!prompt.trim()) return toast.error("Please enter a topic");
    
    setIsGenerating(true);
    setScriptData(null);
    setCurrentSceneIndex(0);
    setCaptionWord("");
    imagesCache.current = {};

    try {
      const res = await fetch("/api/admin/videos/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt })
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to generate script");
      }

      const data: ScriptData = await res.json();
      setScriptData(data);
      toast.success("Script generated! Pre-loading scenes...");

      // Preload all images blocking
      const imagePromises = data.scenes.map((scene, index) => {
        return new Promise<void>((resolve) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          
          // Append unique scene sequence and a completely random seed to guarantee image variety
          const uniquePrompt = `${scene.imagePrompt}, distinct scene ${index + 1}`;
          img.src = `https://image.pollinations.ai/prompt/${encodeURIComponent(uniquePrompt)}?width=1080&height=1920&nologo=true&seed=${Math.floor(Math.random() * 1000000) + index}`;
          
          img.onload = () => {
            imagesCache.current[index] = img;
            if (index === 0) drawStaticFrame(img);
            resolve();
          };
          img.onerror = () => {
             // Resolve anyway to avoid blocking forever if one image fails
             resolve();
          };
        });
      });

      await Promise.all(imagePromises);
      toast.success("All scenes fully loaded and ready to play!");

    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const renderLoop = () => {
    const state = playbackStateRef.current;
    
    // Fallback to previous image if current scene image failed to load
    let img = imagesCache.current[state.sceneIndex];
    if (!img && state.sceneIndex > 0) {
      img = imagesCache.current[state.sceneIndex - 1];
    }
    
    if (img && canvasRef.current) {
      const elapsed = (performance.now() - state.startTime) / 1000; // seconds
      
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Ken Burns Zoom/Pan Math
        // Starts at 1.0, grows slowly by 3% every second
        const zoom = 1.0 + (elapsed * 0.03); 
        const scale = Math.max(canvas.width / img.width, canvas.height / img.height) * zoom;
        
        // Pan left slowly
        const panX = elapsed * 15;
        
        const x = (canvas.width / 2) - (img.width / 2) * scale - panX;
        const y = (canvas.height / 2) - (img.height / 2) * scale;
        
        ctx.drawImage(img, x, y, img.width * scale, img.height * scale);

        // Draw Vignette overlay for text readability
        const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
        gradient.addColorStop(0, "rgba(0,0,0,0.1)");
        gradient.addColorStop(0.5, "rgba(0,0,0,0)");
        gradient.addColorStop(1, "rgba(0,0,0,0.8)");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw Caption
        if (state.word) {
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          
          // TikTok style font
          ctx.font = "bold 120px Inter, sans-serif";
          
          const textX = canvas.width / 2;
          const textY = canvas.height * 0.75;

          // Draw stroke
          ctx.strokeStyle = "black";
          ctx.lineWidth = 20;
          ctx.lineJoin = "round";
          ctx.strokeText(state.word, textX, textY);

          // Draw fill (vibrant yellow/white)
          ctx.fillStyle = "#FFDE00"; // TikTok Yellow
          ctx.fillText(state.word, textX, textY);
        }
      }
    }
    
    if (playbackStateRef.current.isPlaying) {
      animationFrameRef.current = requestAnimationFrame(renderLoop);
    }
  };

  // Helper to instantly draw a static frame (e.g. for preview before playing)
  const drawStaticFrame = (img: HTMLImageElement) => {
    playbackStateRef.current = { ...playbackStateRef.current, sceneIndex: 0, word: "", startTime: performance.now(), isPlaying: false };
    renderLoop();
  };

  const playVideo = async (record = false) => {
    if (!scriptData || !canvasRef.current) return;
    
    // Setup recording if requested
    if (record) {
      recordedChunksRef.current = [];
      const stream = canvasRef.current.captureStream(30); // 30 FPS
      
      // We will try to add audio to the stream later using WebAudio API if possible,
      // but for now we focus on the canvas recording. Due to browser limitations, 
      // recording SpeechSynthesis directly to the canvas stream requires a complex AudioContext routing.
      // We will record the video track.
      
      mediaRecorderRef.current = new MediaRecorder(stream, { mimeType: "video/webm" });
      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: "video/webm" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${scriptData.title.replace(/\s+/g, '_')}.webm`;
        a.click();
        URL.revokeObjectURL(url);
        setIsRecording(false);
      };
      
      mediaRecorderRef.current.start();
      setIsRecording(true);
    }

    setIsPlaying(true);
    setCurrentSceneIndex(0);
    playbackStateRef.current = { ...playbackStateRef.current, isPlaying: true, startTime: performance.now(), sceneIndex: 0 };
    renderLoop();

    for (let i = 0; i < scriptData.scenes.length; i++) {
      setCurrentSceneIndex(i);
      playbackStateRef.current.sceneIndex = i;
      playbackStateRef.current.startTime = performance.now(); // reset start time for zoom effect
      
      const scene = scriptData.scenes[i];

      await new Promise<void>((resolve) => {
        const utterance = new SpeechSynthesisUtterance(scene.narration);
        utterance.rate = 1.1; // Slightly fast TikTok pacing
        utterance.pitch = 1.0;
        
        // Find a good english voice if available
        const voices = speechSynthesis.getVoices();
        const preferredVoice = voices.find(v => v.name.includes("Google") || v.name.includes("Premium") || v.lang === "en-US");
        if (preferredVoice) utterance.voice = preferredVoice;

        // Dynamic captions via boundary events
        utterance.onboundary = (event) => {
          if (event.name === "word") {
            // Extract the word
            const word = scene.narration.substring(event.charIndex, event.charIndex + event.charLength);
            setCaptionWord(word);
            playbackStateRef.current.word = word.toUpperCase();
          }
        };

        utterance.onend = () => {
          setCaptionWord("");
          playbackStateRef.current.word = "";
          resolve();
        };

        speechSynthesis.speak(utterance);
      });
    }

    setIsPlaying(false);
    playbackStateRef.current.isPlaying = false;
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);

    if (record && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
    }
  };

  // Ensure voices are loaded
  useEffect(() => {
    speechSynthesis.getVoices();
  }, []);

  return (
    <div className="relative flex h-full flex-col p-8 overflow-hidden">
      {/* Dynamic Background Mesh */}
      <div className="absolute inset-0 pointer-events-none opacity-20">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-500 blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-purple-600 blur-[120px]" />
      </div>

      <div className="relative z-10 mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-purple-400 flex items-center gap-3">
            <Video className="h-9 w-9 text-indigo-400" />
            Social Video Generator
          </h1>
          <p className="mt-2 text-white/60 font-medium">Generate premium short-form videos with Pollinations AI.</p>
        </div>
      </div>

      <div className="relative z-10 grid grid-cols-1 lg:grid-cols-3 gap-8 h-[calc(100vh-180px)]">
        {/* Left Column: Controls */}
        <div className="col-span-1 flex flex-col gap-6">
          <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-6 shadow-2xl relative overflow-hidden group">
            {/* Subtle inner glow */}
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 to-purple-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            
            <div className="relative z-10 flex flex-col gap-4">
              <label className="text-xs font-bold text-white/80 uppercase tracking-widest">Video Topic</label>
              <textarea
                className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-white min-h-[120px] focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all resize-none shadow-inner"
                placeholder="e.g. Top 3 AI coding tools that will replace software engineers..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
              <button
                onClick={generateScript}
                disabled={isGenerating}
                className="w-full relative overflow-hidden bg-white text-black font-extrabold rounded-2xl py-4 flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100 transition-all shadow-[0_0_20px_rgba(255,255,255,0.1)] hover:shadow-[0_0_30px_rgba(255,255,255,0.3)]"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Generating Pipeline...
                  </>
                ) : (
                  <>
                    <Wand2 className="w-5 h-5" />
                    Generate Video
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Script Overview (if generated) */}
          {scriptData && (
            <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-6 flex flex-col gap-4 flex-1 overflow-y-auto shadow-2xl">
              <h3 className="font-bold text-white uppercase tracking-wider text-sm flex items-center gap-2">
                <Type className="w-4 h-4 text-purple-400" /> Script Timeline
              </h3>
              <p className="text-sm bg-indigo-500/10 text-indigo-300 p-4 rounded-2xl border border-indigo-500/20 font-semibold leading-relaxed">
                {scriptData.title}
              </p>
              
              <div className="flex flex-col gap-3 mt-4 relative">
                {/* Vertical timeline line */}
                <div className="absolute left-[15px] top-4 bottom-4 w-px bg-white/10" />

                {scriptData.scenes.map((scene, i) => {
                  const isActive = currentSceneIndex === i && isPlaying;
                  return (
                    <div key={i} className={`relative pl-10 transition-all duration-300 ${isActive ? 'scale-[1.02] origin-left' : 'opacity-70 hover:opacity-100'}`}>
                      {/* Timeline dot */}
                      <div className={`absolute left-[11px] top-5 w-2 h-2 rounded-full transition-all duration-300 ${isActive ? 'bg-indigo-400 shadow-[0_0_15px_rgba(129,140,248,1)] scale-150' : 'bg-white/20'}`} />
                      
                      <div className={`p-4 rounded-2xl border backdrop-blur-md transition-all duration-300 ${isActive ? 'border-indigo-500/50 bg-indigo-500/10 shadow-[0_0_30px_rgba(99,102,241,0.15)]' : 'border-white/5 bg-black/40'}`}>
                        <div className="flex items-center justify-between gap-2 mb-3">
                          <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded-md ${isActive ? 'bg-indigo-500 text-white' : 'bg-white/10 text-white/60'}`}>
                            Scene {i + 1}
                          </span>
                        </div>
                        <p className="text-[10px] uppercase tracking-wider text-white/40 mb-2 font-mono line-clamp-1">{scene.imagePrompt}</p>
                        <p className="text-sm text-white/90 leading-relaxed font-medium">"{scene.narration}"</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Player */}
        <div className="col-span-2 bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8 flex flex-col items-center justify-center relative shadow-2xl">
          
          {/* Phone Frame Mockup */}
          <div className="relative w-full max-w-[380px] aspect-[9/16] bg-[#0a0a0a] rounded-[3rem] border-[12px] border-[#222] overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.5)] flex items-center justify-center group">
            
            {/* Dynamic Island / Notch */}
            <div className="absolute top-0 inset-x-0 h-7 flex justify-center z-40">
               <div className="w-32 h-6 bg-[#222] rounded-b-3xl" />
            </div>

            {/* The actual canvas where the video is rendered */}
            <canvas 
              ref={canvasRef} 
              width={1080} 
              height={1920} 
              className="w-full h-full object-cover bg-[#0a0a0a]"
            />

            {!scriptData && !isGenerating && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-white/20">
                <Video className="w-20 h-20 opacity-30" />
                <p className="font-medium tracking-wide">Preview Ready</p>
              </div>
            )}

            {isGenerating && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#0a0a0a]/90 backdrop-blur-md z-30">
                <Loader2 className="w-12 h-12 animate-spin text-indigo-500" />
                <p className="text-indigo-400 font-bold animate-pulse tracking-wide">Building Timeline...</p>
              </div>
            )}
            
            {/* Play overlay button if ready but not playing */}
            {scriptData && !isPlaying && !isGenerating && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 hover:bg-black/20 transition-all z-30 group-hover:bg-black/10 cursor-pointer" onClick={() => playVideo(false)}>
                <div className="w-20 h-20 bg-white/10 backdrop-blur-md border border-white/20 text-white rounded-full flex items-center justify-center shadow-2xl group-hover:scale-110 transition-transform">
                  <Play className="w-10 h-10 ml-2" fill="currentColor" />
                </div>
              </div>
            )}

            {/* Docked Controls inside phone */}
            {scriptData && (
              <div className={`absolute bottom-6 inset-x-6 z-40 flex items-center gap-3 transition-transform duration-500 ${isPlaying ? 'translate-y-[200%]' : 'translate-y-0'}`}>
                <button
                  onClick={(e) => { e.stopPropagation(); playVideo(false); }}
                  disabled={isPlaying}
                  className="flex-1 bg-white/20 hover:bg-white/30 backdrop-blur-xl border border-white/20 text-white py-3 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50 shadow-lg"
                >
                  <Play className="w-4 h-4" fill="currentColor" />
                  Preview
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); playVideo(true); }}
                  disabled={isPlaying || isRecording}
                  className="flex-1 bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-400 hover:to-purple-400 text-white py-3 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50 shadow-[0_0_20px_rgba(99,102,241,0.4)]"
                >
                  {isRecording ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  Export
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
