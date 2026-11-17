'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import { Camera, Loader2, Video, VideoOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ENV } from '@/lib/env'
import {
  authorizeLiveCamera,
  fetchCameraSnapshot,
  fetchLiveCameraChallenge,
  heartbeatLiveCamera,
  stopLiveCamera,
  type LiveCameraSession,
} from '@/lib/garage-door'
import { playMjpegStream } from '@/lib/mjpeg-player'

type LiveCameraProps = {
  passkeyId?: string
  canOperate: boolean
}

function isSafariBrowser() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|Edg|EdgiOS|OPR|Android/i.test(ua)
}

export function LiveCamera({ passkeyId, canOperate }: LiveCameraProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const mjpegRef = useRef<HTMLImageElement | null>(null)
  const hlsRef = useRef<Hls | null>(null)
  const tokenRef = useRef<string | null>(null)
  const snapshotObjectUrl = useRef<string | null>(null)
  const [supportsLive, setSupportsLive] = useState(false)
  const [browserReady, setBrowserReady] = useState(false)
  const [liveLoading, setLiveLoading] = useState(false)
  const [snapLoading, setSnapLoading] = useState(false)
  const [livePlaying, setLivePlaying] = useState(false)
  const [session, setSession] = useState<LiveCameraSession | null>(null)
  const [liveError, setLiveError] = useState<string | null>(null)
  const [snapError, setSnapError] = useState<string | null>(null)
  const [hasFrame, setHasFrame] = useState(false)
  const [stillSrc, setStillSrc] = useState<string | null>(null)

  useEffect(() => {
    setSupportsLive(!isSafariBrowser())
    setBrowserReady(true)
  }, [])

  const tearDownHls = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.removeAttribute('src')
      videoRef.current.load()
    }
  }, [])

  const applySession = useCallback((next: LiveCameraSession) => {
    tokenRef.current = next.token
    setSession(next)
    return next
  }, [])

  const ensureSession = useCallback(async () => {
    if (session && tokenRef.current) return session
    if (!passkeyId) throw new Error('Passkey required')
    const challenge = await fetchLiveCameraChallenge()
    return applySession(await authorizeLiveCamera(challenge, passkeyId, ENV.RP_ID))
  }, [applySession, passkeyId, session])

  const handleStopLive = useCallback(() => {
    setLivePlaying(false)
    setHasFrame(false)
    setLiveError(null)
    tearDownHls()
  }, [tearDownHls])

  const handleStartLive = async () => {
    if (!passkeyId) {
      setLiveError('Passkey required')
      return
    }
    setLiveLoading(true)
    setLiveError(null)
    try {
      const next = await ensureSession()
      setHasFrame(false)
      setLivePlaying(true)
      applySession(next)
    } catch (e) {
      setLivePlaying(false)
      setLiveError(e instanceof Error ? e.message : 'Failed to start live camera')
    } finally {
      setLiveLoading(false)
    }
  }

  const handleTakePicture = async () => {
    if (!passkeyId) {
      setSnapError('Passkey required')
      return
    }
    setSnapLoading(true)
    setSnapError(null)
    try {
      const next = await ensureSession()
      const blob = await fetchCameraSnapshot(next.token, next.snapshotUrl)
      if (snapshotObjectUrl.current) URL.revokeObjectURL(snapshotObjectUrl.current)
      const url = URL.createObjectURL(blob)
      snapshotObjectUrl.current = url
      setStillSrc(url)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to take picture'
      if (/auth_failed|401/.test(message)) {
        tokenRef.current = null
        setSession(null)
        setLivePlaying(false)
        tearDownHls()
      }
      setSnapError(message)
    } finally {
      setSnapLoading(false)
    }
  }

  useEffect(() => {
    if (!livePlaying || !session || session.mode !== 'hls') {
      if (!livePlaying) tearDownHls()
      return
    }
    const video = videoRef.current
    if (!video) return
    const onPlaying = () => setHasFrame(true)
    video.addEventListener('playing', onPlaying)

    const nativeHls = Boolean(video.canPlayType('application/vnd.apple.mpegurl'))
    if (nativeHls) {
      video.src = session.streamUrl
      video.play().catch(() => undefined)
      return () => {
        video.removeEventListener('playing', onPlaying)
        video.removeAttribute('src')
        video.load()
      }
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        liveSyncDurationCount: 2,
      })
      hlsRef.current = hls
      hls.loadSource(session.streamUrl)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => undefined)
      })
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) setLiveError('Live stream failed')
      })
      return () => {
        video.removeEventListener('playing', onPlaying)
        hls.destroy()
        if (hlsRef.current === hls) hlsRef.current = null
      }
    }

    setLiveError('HLS is not supported in this browser')
    return () => video.removeEventListener('playing', onPlaying)
  }, [livePlaying, session?.mode, session?.streamUrl, tearDownHls])

  useEffect(() => {
    if (!livePlaying || !session || session.mode !== 'mjpeg') return
    const img = mjpegRef.current
    if (!img) return
    const ac = new AbortController()
    setHasFrame(false)
    playMjpegStream(session.streamUrl, img, ac.signal, {
      onFrame: () => setHasFrame(true),
    }).catch((e) => {
      if (ac.signal.aborted) return
      setLiveError(e instanceof Error ? e.message : 'Live stream failed')
    })
    return () => ac.abort()
  }, [livePlaying, session?.mode, session?.streamUrl])

  useEffect(() => {
    if (!session?.token) return
    const token = session.token
    const id = window.setInterval(async () => {
      try {
        const next = await heartbeatLiveCamera(token)
        tokenRef.current = next.token
        setSession((prev) =>
          prev
            ? { ...prev, expiresAt: next.expiresAt, ttlSec: next.ttlSec, snapshotUrl: next.snapshotUrl }
            : next
        )
      } catch {
        tokenRef.current = null
        setSession(null)
        setLivePlaying(false)
        tearDownHls()
        setLiveError('Camera session expired. Sign again to continue.')
      }
    }, 30_000)
    return () => window.clearInterval(id)
  }, [session?.token, tearDownHls])

  useEffect(() => {
    return () => {
      tearDownHls()
      if (snapshotObjectUrl.current) URL.revokeObjectURL(snapshotObjectUrl.current)
      if (tokenRef.current) void stopLiveCamera(tokenRef.current)
    }
  }, [tearDownHls])

  return (
    <div className="bg-slate-800/50 rounded-2xl border border-slate-700 p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Garage Camera</h2>
        {livePlaying && (
          <span className="text-xs font-semibold tracking-wide text-red-400">
            ● LIVE
          </span>
        )}
      </div>

      <div className="space-y-3">
        {browserReady && supportsLive && (
          livePlaying ? (
            <Button
              onClick={handleStopLive}
              className="w-full h-14 bg-slate-600 hover:bg-slate-500 text-white font-semibold text-lg"
              size="lg"
            >
              <VideoOff className="h-5 w-5 mr-2" />
              Stop Live Feed
            </Button>
          ) : (
            <Button
              onClick={handleStartLive}
              disabled={liveLoading || !passkeyId || !canOperate}
              className="w-full h-14 bg-amber-500 hover:bg-amber-600 text-slate-900 font-semibold text-lg disabled:opacity-50"
              size="lg"
            >
              {liveLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <Video className="h-5 w-5 mr-2" />
                  Watch Live Feed
                </>
              )}
            </Button>
          )
        )}

        <Button
          onClick={handleTakePicture}
          disabled={snapLoading || !passkeyId || !canOperate}
          className="w-full h-14 bg-sky-500 hover:bg-sky-600 text-slate-900 font-semibold text-lg disabled:opacity-50"
          size="lg"
        >
          {snapLoading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <>
              <Camera className="h-5 w-5 mr-2" />
              Take Picture
            </>
          )}
        </Button>

        {browserReady && !supportsLive && (
          <p className="text-slate-400 text-sm">
            Safari uses a still image — live stream is available in Chrome, Edge, or Firefox.
          </p>
        )}

        {liveError && <p className="text-red-400 text-sm">{liveError}</p>}
        {snapError && <p className="text-red-400 text-sm">{snapError}</p>}

        {livePlaying && session?.mode === 'mjpeg' && (
          <div className="relative rounded-lg overflow-hidden border border-slate-600 bg-black">
            {!hasFrame && (
              <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-sm">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Connecting stream…
              </div>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={mjpegRef}
              alt="Garage live camera"
              referrerPolicy="no-referrer"
              className={`w-full h-auto min-h-40 ${hasFrame ? '' : 'opacity-0'}`}
            />
          </div>
        )}
        {livePlaying && session?.mode === 'hls' && (
          <div className="relative rounded-lg overflow-hidden border border-slate-600 bg-black">
            {!hasFrame && (
              <div className="absolute inset-0 z-10 flex items-center justify-center text-slate-400 text-sm">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Connecting stream…
              </div>
            )}
            <video
              ref={videoRef}
              className="w-full h-auto min-h-40"
              autoPlay
              muted
              playsInline
              controls
            />
          </div>
        )}

        {stillSrc && (
          <div className="rounded-lg overflow-hidden border border-slate-600 bg-black">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={stillSrc} alt="Garage still" className="w-full h-auto" />
          </div>
        )}
      </div>
    </div>
  )
}
