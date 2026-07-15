-- 024: 디스크 관제 + 원격 Temp 정리 (2026-07-15)
--
-- heartbeat 가 C드라이브 용량을 실어오고, 패널/HQ 가 경고 배지를 띄우며,
-- [디스크 정리] 버튼이 cleanup_requested_at 을 찍으면 에이전트가 다음 heartbeat
-- 응답에서 명령을 받아 Temp(전 프로필+윈도우)+휴지통을 영구삭제로 비운다.
-- 전부 표시·명령용 telemetry — 매칭/신원 키 아님.

ALTER TABLE customers ADD COLUMN IF NOT EXISTS disk_total_bytes BIGINT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS disk_free_bytes BIGINT;
-- Temp 폴더 실측(선택 보고 — 여유 부족일 때만 에이전트가 측정해 보냄)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS temp_bytes BIGINT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS disk_reported_at TIMESTAMPTZ;
-- 정리 명령 큐: 버튼이 now() 를 찍고, 에이전트가 결과를 보고하면 서버가 비운다.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS cleanup_requested_at TIMESTAMPTZ;
-- 마지막 정리 결과 JSON: {"freedBytes":..,"deleted":..,"skipped":..,"at":"ISO"}
ALTER TABLE customers ADD COLUMN IF NOT EXISTS cleanup_result TEXT;
