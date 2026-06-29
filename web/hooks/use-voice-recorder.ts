"use client"

import { useCallback, useRef, useState } from "react"

export type RecorderStatus = "idle" | "recording" | "unsupported" | "denied"

const PREFERRED_MIME = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined
  return PREFERRED_MIME.find((m) => MediaRecorder.isTypeSupported(m))
}

export function useVoiceRecorder() {
  const [status, setStatus] = useState<RecorderStatus>(() =>
    typeof MediaRecorder === "undefined" ? "unsupported" : "idle"
  )
  const [seconds, setSeconds] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    recorderRef.current = null
    chunksRef.current = []
    setSeconds(0)
  }, [])

  const start = useCallback(async () => {
    if (
      typeof MediaRecorder === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setStatus("unsupported")
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mimeType = pickMimeType()
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined
      )
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.start()
      recorderRef.current = recorder
      setSeconds(0)
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000)
      setStatus("recording")
    } catch {
      cleanup()
      setStatus("denied")
    }
  }, [cleanup])

  const stop = useCallback((): Promise<Blob | null> => {
    const recorder = recorderRef.current
    if (!recorder) {
      setStatus("idle")
      return Promise.resolve(null)
    }
    return new Promise<Blob | null>((resolve) => {
      recorder.onstop = () => {
        const type = recorder.mimeType || "audio/webm"
        const blob = chunksRef.current.length
          ? new Blob(chunksRef.current, { type })
          : null
        cleanup()
        setStatus("idle")
        resolve(blob)
      }
      recorder.stop()
    })
  }, [cleanup])

  const cancel = useCallback(() => {
    const recorder = recorderRef.current
    if (recorder) {
      recorder.onstop = null
      if (recorder.state !== "inactive") recorder.stop()
    }
    cleanup()
    setStatus("idle")
  }, [cleanup])

  return { status, seconds, start, stop, cancel }
}
