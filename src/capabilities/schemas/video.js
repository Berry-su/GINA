// src/capabilities/schemas/video.js — Video 工具 schema（ADR-013 · Phase 6 · PLAN-P6 完工）
//
// 3 个 tool 暴露给 LLM：
//   - query_video         : 查视频元数据 / 列举本地视频 / 查 job 状态
//   - summarize_video     : 视频摘要（帧采样 + VLM + Whisper + 章节）
//   - extract_video_frames: 纯抽帧（无 VLM/Whisper）
//
// 统一参数约定：
//   - source: 视频源（local path / URL / m3u8）
//   - provider: 'mock' | 'vlm-gpt4v' | 'vlm-qwen' | 'ffmpeg'
//
// emotion-isolation 严守（沿用 Phase 1/2/3/4）：
//   - tool 输出只走事实通道（"视频 X 分钟 Y 章节"），不触发 joy
//   - 视频处理是后台任务，**不触发 joy 也不进决策**
//   - LLM 拿到的 string 描述里不带 emotion 词

export const videoSchemas = {
  query_video: {
    type: 'function',
    function: {
      name: 'query_video',
      description:
        'Inspect video metadata or query background video processing jobs. List local videos in a directory, probe a specific video file (duration, resolution, codec), or check status of an async summarize_video / extract_video_frames job. Returns pure fact data only and never influences the agent\'s internal state or decision path.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list_local', 'probe', 'get_job', 'list_jobs', 'status'],
            description: 'Operation to perform. list_local: list local videos in a directory. probe: read video metadata (duration/resolution/codec). get_job: query one async job by jobId. list_jobs: list all active jobs. status: aggregate provider/cache stats.',
          },
          dir: {
            type: 'string',
            description: 'Directory to list videos from (list_local). Defaults to ~/Movies. Supports ~ expansion.',
          },
          source: {
            type: 'string',
            description: 'Video source path/URL (probe). Local path only; url-public and streaming sources are stub-only.',
          },
          jobId: {
            type: 'string',
            description: 'Job ID returned by summarize_video / extract_video_frames (get_job).',
          },
          limit: {
            type: 'number',
            description: 'Max items to return (list_local). Default 20, max 100.',
          },
          recursive: {
            type: 'boolean',
            description: 'Recurse into subdirectories (list_local). Default false.',
          },
        },
        required: ['action'],
      },
    },
  },

  summarize_video: {
    type: 'function',
    function: {
      name: 'summarize_video',
      description:
        'Process a video: sample frames (FFmpeg), understand key moments (VLM/Phase 1), transcribe audio (Whisper/Phase 1), cluster into chapters, and produce a multimodal summary. Supports local video files; url-public/streaming sources are stub-only unless GINA_VIDEO_YT_DLP=1. Async: returns immediately with jobId, the real processing happens in background. This tool returns pure fact data only and never influences the agent\'s internal state or decision path.',
      parameters: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Video source: local absolute path, http(s):// URL (public video), or m3u8 HLS stream URL.',
          },
          provider: {
            type: 'string',
            enum: ['mock', 'vlm-gpt4v', 'vlm-qwen'],
            description: 'Summarization provider. mock (default, no real API calls) | vlm-gpt4v (Phase 1 GPT-4o-vision, requires openaiKey) | vlm-qwen (Phase 1 Qwen-VL stub).',
          },
          frameIntervalSec: {
            type: 'number',
            description: 'Frame sampling interval in seconds. Default 30 (1 frame per 30s = 2 frames per minute).',
          },
          maxFrames: {
            type: 'number',
            description: 'Maximum number of frames to sample. Default 30.',
          },
          language: {
            type: 'string',
            enum: ['auto', 'zh', 'en', 'ja', 'ko', 'fr', 'es'],
            description: 'Audio transcription language. Default "auto" (Whisper auto-detect).',
          },
          includeAudio: {
            type: 'boolean',
            description: 'Whether to transcribe audio track. Default true.',
          },
        },
        required: ['source'],
      },
    },
  },

  extract_video_frames: {
    type: 'function',
    function: {
      name: 'extract_video_frames',
      description:
        'Extract frames from a local video using FFmpeg. Supports three strategies: "interval" (every N seconds), "keyframe" (I-frames only), "scene" (scene change detection, stub). Does NOT call VLM/Whisper. Use this when you only need raw frame files for downstream analysis. Local source only. This tool returns pure fact data only and never influences the agent\'s internal state or decision path.',
      parameters: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Local video file path. Url-public / streaming sources are not supported by this tool.',
          },
          strategy: {
            type: 'string',
            enum: ['interval', 'keyframe', 'scene'],
            description: 'Frame sampling strategy. Default "interval".',
          },
          intervalSec: {
            type: 'number',
            description: 'Frame interval in seconds (strategy=interval). Default 1 (1 fps).',
          },
          maxFrames: {
            type: 'number',
            description: 'Maximum number of frames to extract. Default 10, max 100.',
          },
        },
        required: ['source'],
      },
    },
  },

  transcribe_video: {
    type: 'function',
    function: {
      name: 'transcribe_video',
      description:
        'Transcribe the audio track of a local video file via FFmpeg audio extraction + Whisper (Phase 1) or mock (default). Returns subtitle segments with timestamps. Local source only. This tool returns pure fact data only and never influences the agent\'s internal state or decision path.',
      parameters: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Local video file path. Url-public / streaming sources are not supported by this tool.',
          },
          language: {
            type: 'string',
            enum: ['auto', 'zh', 'en', 'ja', 'ko', 'fr', 'es'],
            description: 'Audio language. Default "auto" (Whisper auto-detect).',
          },
          provider: {
            type: 'string',
            enum: ['mock', 'whisper'],
            description: 'Transcription provider. mock (default, returns stub subtitles) | whisper (Phase 1, requires GINA_VOICE_SERVER running).',
          },
        },
        required: ['source'],
      },
    },
  },
}
