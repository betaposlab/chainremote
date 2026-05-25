# ⚠️ DEPRECATED — 사용 금지

이 폴더의 옛 PowerShell 셋업 스크립트들(`setup.ps1`/`fix.ps1`/`RustDesk2.toml`/`적용방법.txt`) 는
**2026-05-25 영구 삭제**. 신규/기존 거래처는 [`deploy/win-installer/`](../win-installer/) 의
`ChainRemote_Agent_Setup_v*.exe` (Inno Setup 인스톨러) 만 사용.

## 왜 삭제했나

`setup.ps1` 이 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` 에 `ChainRemote` 항목을
직접 박는 코드를 포함했음. 한 번 돌리면 부팅마다 자동 실행 + 절대 자동 정리 안 됨.
Chang 의 우리집 윈컴에 `C:\Temp\ChainRemote-v3-extracted\ChainRemote.exe --tray` 잔재로
남아 있었음 (2026-05-25 진단으로 발견). ChainGo SFX 의 "호스트 흔적 0" 원칙과 충돌하는
운영 흔적이라 영구 폐기.

옛 history 가 필요하면 `git log -- deploy/win/setup.ps1` 또는 `git show` 로 복원 가능.

## 잔재 청소 (옛 PC 에 setup.ps1 흔적 있는 사람)

```powershell
Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'ChainRemote' -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force 'C:\Temp\ChainRemote-v3-extracted' -ErrorAction SilentlyContinue
```

정식 인스톨러 사용 후엔 자동으로 발생하지 않음.
