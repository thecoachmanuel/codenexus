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
  const animationFrameRef = useRef<number>();
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

      // Preload images
      data.scenes.forEach((scene, index) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = `https://image.pollinations.ai/prompt/${encodeURIComponent(scene.imagePrompt)}?width=1080&height=1920&nologo=true&seed=${Math.floor(Math.random() * 10000)}`;
        img.onload = () => {
          imagesCache.current[index] = img;
          if (index === 0) drawStaticFrame(img); // Draw first scene when loaded
        };
      });

    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const renderLoop = () => {
    const state = playbackStateRef.current;
    const img = imagesCache.current[state.sceneIndex];
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
    <div className="flex h-full flex-col p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
            <Video className="h-8 w-8 text-indigo-500" />
            Social Video Generator
          </h1>
          <p className="mt-2 text-white/60">Generate unlimited short-form videos with Pollinations AI.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 h-[calc(100vh-200px)]">
        {/* Left Column: Controls */}
        <div className="col-span-1 flex flex-col gap-6">
          <div className="bg-[#111] border border-white/10 rounded-xl p-6 flex flex-col gap-4">
            <label className="text-sm font-medium text-white/80">Video Topic or Prompt</label>
            <textarea
              className="w-full bg-black border border-white/10 rounded-lg p-4 text-white min-h-[120px] focus:outline-none focus:border-indigo-500 transition-colors"
              placeholder="e.g. Top 3 AI coding tools that will replace software engineers..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <button
              onClick={generateScript}
              disabled={isGenerating}
              className="w-full bg-white text-black font-semibold rounded-lg py-3 flex items-center justify-center gap-2 hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
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

          {/* Script Overview (if generated) */}
          {scriptData && (
            <div className="bg-[#111] border border-white/10 rounded-xl p-6 flex flex-col gap-4 flex-1 overflow-y-auto">
              <h3 className="font-semibold text-white">Script Details</h3>
              <p className="text-sm text-indigo-400 font-medium">{scriptData.title}</p>
              
              <div className="flex flex-col gap-4 mt-2">
                {scriptData.scenes.map((scene, i) => (
                  <div key={i} className={`p-4 rounded-lg border ${currentSceneIndex === i && isPlaying ? 'border-indigo-500 bg-indigo-500/10' : 'border-white/5 bg-black/50'}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs px-2 py-1 bg-white/10 rounded-full font-medium">Scene {i + 1}</span>
                      <span className="text-xs text-white/40 truncate">{scene.imagePrompt}</span>
                    </div>
                    <p className="text-sm text-white/80">"{scene.narration}"</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Player */}
        <div className="col-span-2 bg-[#111] border border-white/10 rounded-xl p-6 flex flex-col items-center justify-center relative overflow-hidden">
          <div className="relative w-full max-w-[400px] aspect-[9/16] bg-black rounded-2xl border-4 border-white/5 overflow-hidden shadow-2xl flex items-center justify-center">
            
            {/* The actual canvas where the video is rendered */}
            <canvas 
              ref={canvasRef} 
              width={1080} 
              height={1920} 
              className="w-full h-full object-contain bg-black"
            />

            {!scriptData && !isGenerating && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-white/30">
                <Video className="w-16 h-16 opacity-50" />
                <p>Preview will appear here</p>
              </div>
            )}

            {isGenerating && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/80 backdrop-blur-sm z-10">
                <Loader2 className="w-12 h-12 animate-spin text-indigo-500" />
                <p className="text-indigo-400 font-medium animate-pulse">Rendering via Pollinations...</p>
              </div>
            )}
            
            {/* Play overlay button if ready but not playing */}
            {scriptData && !isPlaying && !isGenerating && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 hover:bg-black/20 transition-all z-20 group cursor-pointer" onClick={() => playVideo(false)}>
                <div className="w-20 h-20 bg-white text-black rounded-full flex items-center justify-center shadow-2xl group-hover:scale-110 transition-transform">
                  <Play className="w-10 h-10 ml-2" fill="currentColor" />
                </div>
              </div>
            )}
          </div>

          {/* Controls */}
          {scriptData && (
            <div className="mt-6 flex items-center gap-4 w-full max-w-[400px]">
              <button
                onClick={() => playVideo(false)}
                disabled={isPlaying}
                className="flex-1 bg-white/10 hover:bg-white/20 text-white py-3 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
              >
                <Play className="w-4 h-4" fill="currentColor" />
                Play Preview
              </button>
              <button
                onClick={() => playVideo(true)}
                disabled={isPlaying || isRecording}
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white py-3 rounded-lg font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
              >
                {isRecording ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                Export Video
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
