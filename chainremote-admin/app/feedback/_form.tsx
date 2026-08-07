"use client";

// 문의 작성 폼. 평소엔 접혀 있고 버튼으로 편다 — 목록을 보러 온 사람이 대부분이라
//   폼이 항상 펼쳐져 있으면 정작 답변 확인이 아래로 밀린다.

import { useEffect, useRef, useState, useTransition } from "react";
import { submitFeedbackAction } from "@/lib/actions/feedback";

const MAX_IMAGES = 3;
const MAX_BYTES = 5 * 1024 * 1024;
// next.config 의 serverActions.bodySizeLimit(16mb)보다 낮게 잡는다. 그 한도에 걸리면
//   요청이 서버 코드에 닿기도 전에 끊겨 안내를 띄울 수가 없다.
const TOTAL_LIMIT = 14 * 1024 * 1024;
const ACCEPT = ["image/png", "image/jpeg", "image/webp"];

export function FeedbackForm() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // 첨부는 폼 필드가 아니라 상태로 들고 있다가 제출 때 FormData 에 넣는다.
  //   붙여넣기로 들어온 이미지는 <input type=file> 에 채울 방법이 마땅치 않아서다.
  const [images, setImages] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  // 제목·내용을 상태로 든다. 서버 액션이 실패하면 React 가 폼을 리셋해서, 길게 쓴 내용이
  //   에러 한 번에 통째로 사라진다(2026-08-07 실제로 겪음). 그 상황이야말로 내용이
  //   남아야 하는 순간이다.
  const [kind, setKind] = useState("suggestion");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  // objectURL 은 명시적으로 풀어 줘야 메모리에 남지 않는다.
  useEffect(() => {
    const urls = images.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [images]);

  const addFiles = (incoming: File[]) => {
    setError(null);
    const picked: File[] = [];
    for (const f of incoming) {
      if (!ACCEPT.includes(f.type)) {
        setError("PNG·JPG·WEBP 이미지만 첨부할 수 있습니다.");
        continue;
      }
      if (f.size > MAX_BYTES) {
        setError(`"${f.name || "이미지"}" 는 5MB 를 넘습니다.`);
        continue;
      }
      picked.push(f);
    }
    if (picked.length === 0) return;
    setImages((prev) => {
      const merged = [...prev, ...picked];
      if (merged.length > MAX_IMAGES) {
        setError(`이미지는 최대 ${MAX_IMAGES}장까지입니다.`);
      }
      return merged.slice(0, MAX_IMAGES);
    });
  };

  // 스크린샷을 찍고 바로 붙여넣는 게 "파일 선택 → 폴더 찾기" 보다 훨씬 빠르다.
  //   신고를 끝까지 마치느냐가 여기서 갈린다.
  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length > 0) {
      e.preventDefault();
      addFiles(files);
    }
  };

  if (!open) {
    return (
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        + 새 문의 보내기
      </button>
    );
  }

  return (
    <form
      className="panel-card p-4 space-y-3"
      onPaste={onPaste}
      action={(fd) => {
        setError(null);
        // 상태로 들고 있던 첨부를 여기서 실어 보낸다(붙여넣기分 포함).
        fd.delete("images");
        images.forEach((f) => fd.append("images", f, f.name || "screenshot.png"));
        // 서버 액션 본문 한도(next.config: 16mb)에 걸리면 서버가 어떤 안내도 못 준다.
        //   가기 전에 여기서 막아야 사용자가 이유를 안다.
        const total = images.reduce((n, f) => n + f.size, 0);
        if (total > TOTAL_LIMIT) {
          setError(
            `첨부 용량 합계가 너무 큽니다 (${(total / 1024 / 1024).toFixed(1)}MB). 장수를 줄여 주세요.`,
          );
          return;
        }
        startTransition(async () => {
          try {
            await submitFeedbackAction(fd);
            setOpen(false);
            setImages([]);
            setTitle("");
            setBody("");
            setKind("suggestion");
          } catch (e) {
            setError(e instanceof Error ? e.message : "전송에 실패했습니다.");
          }
        });
      }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-[#cbd1e0]">유형</label>
        <select
          name="kind"
          className="input w-40"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="suggestion">건의</option>
          <option value="bug">버그 신고</option>
          <option value="other">기타</option>
        </select>
      </div>

      <input
        name="title"
        className="input w-full"
        placeholder="제목 — 한 줄로 요약해 주세요"
        maxLength={120}
        required
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        name="body"
        className="input w-full min-h-[9rem]"
        placeholder={
          "버그라면 어떤 상황에서 생겼는지, 건의라면 어떤 일을 하려다 불편했는지 적어 주시면 가장 도움이 됩니다.\n" +
          "거래처 상호나 화면 이름을 같이 적어 주시면 재현이 훨씬 빨라집니다."
        }
        maxLength={4000}
        required
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />

      {/* 첨부 */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => fileRef.current?.click()}
            disabled={images.length >= MAX_IMAGES}
          >
            이미지 첨부
          </button>
          <span className="text-xs text-[#cbd1e0]">
            {images.length}/{MAX_IMAGES} · 장당 5MB · PNG·JPG·WEBP ·{" "}
            <b className="text-[#c3d3ff]">스크린샷은 Ctrl+V 로 바로 붙여넣기</b>
          </span>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT.join(",")}
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            // 같은 파일을 다시 고를 수 있게 비운다.
            e.target.value = "";
          }}
        />
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {images.map((f, i) => (
              <div
                key={`${f.name}-${i}`}
                className="relative h-24 w-24 overflow-hidden rounded-lg border border-[#566999]"
              >
                {/* 미리보기는 로컬 objectURL — next/image 로 감쌀 이득이 없다. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previews[i]}
                  alt={f.name || "첨부 이미지"}
                  className="h-full w-full object-cover"
                />
                <button
                  type="button"
                  className="absolute right-1 top-1 rounded bg-black/60 px-1.5 text-xs text-white"
                  onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                  aria-label="첨부 제거"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && <div className="banner banner-danger">{error}</div>}

      <div className="flex items-center gap-2">
        <button className="btn btn-primary" disabled={pending}>
          {pending ? "보내는 중..." : "보내기"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={pending}
        >
          취소
        </button>
      </div>
    </form>
  );
}
