import React, { useState, useRef, useEffect } from 'react';
import { Scale, Plug, Unplug, RefreshCw, Settings2, AlertCircle, Activity, BarChart3 } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [weight, setWeight] = useState("0.000");
  const [knownWeight, setKnownWeight] = useState("1.0");
  const [error, setError] = useState("");
  
  // Graph & Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [recordedData, setRecordedData] = useState<{time: string, weight: number}[]>([]);
  const [stats, setStats] = useState<{min: number, max: number, avg: number} | null>(null);

  const portRef = useRef<any>(null);
  const readerRef = useRef<any>(null);
  const writerRef = useRef<any>(null);
  const keepReadingRef = useRef(true);

  // Recording Refs
  const lastWeightRef = useRef<number>(0);
  const isFirstReadingRef = useRef<boolean>(true);
  const isRecordingRef = useRef<boolean>(false);
  const recordingStartTimeRef = useRef<number>(0);
  const recordedDataRef = useRef<{time: string, weight: number}[]>([]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isConnected) {
        disconnect();
      }
    };
  }, [isConnected]);

  const resetRecording = () => {
    setRecordedData([]);
    setStats(null);
    recordedDataRef.current = [];
    isRecordingRef.current = false;
    setIsRecording(false);
  };

  const calculateStats = (data: {time: string, weight: number}[]) => {
    if (data.length === 0) return;
    let min = data[0].weight;
    let max = data[0].weight;
    let sum = 0;
    
    for (const d of data) {
      if (d.weight < min) min = d.weight;
      if (d.weight > max) max = d.weight;
      sum += d.weight;
    }
    
    setStats({ min, max, avg: sum / data.length });
  };

  const processWeightLine = (line: string): boolean => {
    const weightVal = parseFloat(line);
    if (isNaN(weightVal)) return false;
    
    setWeight(line);

    if (isFirstReadingRef.current) {
      lastWeightRef.current = weightVal;
      isFirstReadingRef.current = false;
      return false;
    }

    let dataAdded = false;

    if (!isRecordingRef.current) {
      // Trigger recording if weight changes by more than 1kg and we haven't already recorded
      if (recordedDataRef.current.length === 0 && Math.abs(weightVal - lastWeightRef.current) > 1.0) {
        isRecordingRef.current = true;
        setIsRecording(true);
        recordingStartTimeRef.current = Date.now();
        recordedDataRef.current = [{ time: "0.0", weight: weightVal }];
        setStats(null); // Clear previous stats
        dataAdded = true;
      }
    } else {
      const elapsed = Date.now() - recordingStartTimeRef.current;
      if (elapsed <= 30000) {
        // Still within 30 seconds, record data
        recordedDataRef.current.push({ time: (elapsed / 1000).toFixed(1), weight: weightVal });
        dataAdded = true;
      } else {
        // 30 seconds passed, stop recording
        isRecordingRef.current = false;
        setIsRecording(false);
        calculateStats(recordedDataRef.current);
      }
    }
    
    lastWeightRef.current = weightVal;
    return dataAdded;
  };

  const connect = async () => {
    if (!('serial' in navigator)) {
      setError("Web Serial API is not supported in this browser. Please use Chrome or Edge.");
      return;
    }

    try {
      setError("");
      // Request a port and open a connection
      const port = await (navigator as any).serial.requestPort();
      await port.open({ baudRate: 115200 });
      
      portRef.current = port;
      writerRef.current = port.writable.getWriter();
      setIsConnected(true);
      keepReadingRef.current = true;
      isFirstReadingRef.current = true; // Reset first reading flag
      
      readSerial();
    } catch (err: any) {
      setError(`Connection error: ${err.message}`);
    }
  };

  const disconnect = async () => {
    keepReadingRef.current = false;
    
    try {
      if (readerRef.current) {
        await readerRef.current.cancel();
        readerRef.current = null;
      }
      
      if (writerRef.current) {
        writerRef.current.releaseLock();
        writerRef.current = null;
      }
      
      if (portRef.current) {
        await portRef.current.close();
        portRef.current = null;
      }
    } catch (err) {
      console.error("Error during disconnect:", err);
    }
    
    setIsConnected(false);
    setWeight("0.000");
    setIsRecording(false);
    isRecordingRef.current = false;
  };

  const readSerial = async () => {
    const port = portRef.current;
    if (!port) return;

    while (port.readable && keepReadingRef.current) {
      const reader = port.readable.getReader();
      readerRef.current = reader;
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (keepReadingRef.current) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          if (value) {
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            
            if (lines.length > 1) {
              let shouldUpdateState = false;
              
              // Process all complete lines
              for (let i = 0; i < lines.length - 1; i++) {
                const line = lines[i].trim();
                if (line) {
                  if (processWeightLine(line)) {
                    shouldUpdateState = true;
                  }
                }
              }
              
              // Batch state update for performance
              if (shouldUpdateState) {
                setRecordedData([...recordedDataRef.current]);
              }
              
              // Keep the incomplete part
              buffer = lines[lines.length - 1];
            }
          }
        }
      } catch (error) {
        console.error("Error reading from serial port:", error);
      } finally {
        reader.releaseLock();
      }
    }
  };

  const sendTare = async () => {
    if (!writerRef.current) return;
    try {
      const encoder = new TextEncoder();
      await writerRef.current.write(encoder.encode('T'));
    } catch (err: any) {
      setError(`Tare error: ${err.message}`);
    }
  };

  const sendCalibrate = async () => {
    if (!writerRef.current) return;
    
    const weightVal = parseFloat(knownWeight);
    if (isNaN(weightVal)) {
      setError("Please enter a valid number for calibration.");
      return;
    }

    try {
      const encoder = new TextEncoder();
      await writerRef.current.write(encoder.encode('C'));
      await writerRef.current.write(encoder.encode(`${weightVal}\n`));
    } catch (err: any) {
      setError(`Calibration error: ${err.message}`);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 lg:p-8 font-sans">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl overflow-hidden border border-slate-100 flex flex-col lg:flex-row">
        
        {/* Left Column: Controls */}
        <div className="w-full lg:w-1/3 bg-slate-900 p-6 lg:p-8 text-white flex flex-col">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <Scale className="w-6 h-6 text-emerald-400" />
              <h1 className="text-xl font-semibold tracking-tight">Arduino Scale</h1>
            </div>
            <div className="flex items-center gap-2 text-sm font-medium">
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]' : 'bg-rose-500'}`}></div>
              <span className={isConnected ? 'text-emerald-400' : 'text-rose-400'}>
                {isConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
          </div>

          <div className="flex-1 flex flex-col justify-center">
            <div className="flex flex-col items-center justify-center py-10 bg-slate-800/50 rounded-2xl border border-slate-700/50 mb-8">
              <div className="text-5xl font-mono font-bold tracking-tight text-white mb-2">
                {weight}
              </div>
              <div className="text-slate-400 font-medium uppercase tracking-widest text-sm">
                Kilograms
              </div>
            </div>

            <div className="space-y-4">
              {!isConnected ? (
                <button
                  onClick={connect}
                  className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-medium py-3.5 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Plug className="w-5 h-5" />
                  Connect to Arduino
                </button>
              ) : (
                <button
                  onClick={disconnect}
                  className="w-full bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 font-medium py-3.5 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer border border-rose-500/20"
                >
                  <Unplug className="w-5 h-5" />
                  Disconnect
                </button>
              )}

              <button
                onClick={sendTare}
                disabled={!isConnected}
                className="w-full bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3.5 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer border border-slate-700"
              >
                <RefreshCw className="w-5 h-5" />
                Tare (Zero Scale)
              </button>
            </div>

            <div className="pt-8 mt-8 border-t border-slate-800">
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Calibration Weight (kg)
              </label>
              <div className="flex flex-col gap-3">
                <input
                  type="number"
                  step="0.01"
                  value={knownWeight}
                  onChange={(e) => setKnownWeight(e.target.value)}
                  disabled={!isConnected}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent disabled:opacity-50"
                  placeholder="e.g. 1.0"
                />
                <button
                  onClick={sendCalibrate}
                  disabled={!isConnected}
                  className="w-full bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3.5 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer border border-slate-700"
                >
                  <Settings2 className="w-5 h-5" />
                  Calibrate
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Graph & Stats */}
        <div className="w-full lg:w-2/3 p-6 lg:p-8 flex flex-col bg-white">
          {error && (
            <div className="bg-rose-50 text-rose-600 p-4 rounded-xl flex items-start gap-3 text-sm mb-6">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <p>{error}</p>
            </div>
          )}

          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
              <Activity className="w-5 h-5 text-slate-500" />
              Weight Recording
            </h2>
            
            <div className="flex items-center gap-3">
              {isRecording && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-rose-50 text-rose-600 rounded-full text-sm font-medium border border-rose-100">
                  <div className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></div>
                  Recording...
                </div>
              )}
              {!isRecording && recordedData.length > 0 && (
                <>
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 text-slate-600 rounded-full text-sm font-medium">
                    <BarChart3 className="w-4 h-4" />
                    Recording Complete
                  </div>
                  <button
                    onClick={resetRecording}
                    className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-full text-sm font-medium transition-colors cursor-pointer"
                  >
                    Reset
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="flex-1 min-h-[300px] bg-slate-50 rounded-2xl border border-slate-100 p-4 flex flex-col justify-center relative">
            {recordedData.length === 0 ? (
              <div className="text-center text-slate-400 p-8">
                <Activity className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <p className="font-medium">Waiting for weight change (&gt; 1kg) to start recording...</p>
                <p className="text-sm mt-1">Records for 30 seconds automatically.</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={recordedData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis 
                    dataKey="time" 
                    stroke="#94a3b8" 
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={30}
                  />
                  <YAxis 
                    domain={['auto', 'auto']} 
                    stroke="#94a3b8" 
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(val) => `${val}kg`}
                  />
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    labelFormatter={(label) => `${label}s`}
                    formatter={(value: number) => [`${value} kg`, 'Weight']}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="weight" 
                    stroke="#10b981" 
                    strokeWidth={3}
                    dot={false}
                    activeDot={{ r: 6, fill: "#10b981", stroke: "#fff", strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Stats Section */}
          <div className="mt-6 grid grid-cols-3 gap-4">
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 text-center transition-all">
              <div className="text-sm text-slate-500 font-medium mb-1">Min Weight</div>
              <div className="text-2xl font-bold text-slate-900 font-mono">
                {stats ? stats.min.toFixed(3) : "---"} <span className="text-sm text-slate-400 font-sans">kg</span>
              </div>
            </div>
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 text-center transition-all">
              <div className="text-sm text-slate-500 font-medium mb-1">Max Weight</div>
              <div className="text-2xl font-bold text-slate-900 font-mono">
                {stats ? stats.max.toFixed(3) : "---"} <span className="text-sm text-slate-400 font-sans">kg</span>
              </div>
            </div>
            <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 text-center transition-all">
              <div className="text-sm text-slate-500 font-medium mb-1">Average</div>
              <div className="text-2xl font-bold text-emerald-600 font-mono">
                {stats ? stats.avg.toFixed(3) : "---"} <span className="text-sm text-emerald-400 font-sans">kg</span>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
