// 직결 실패 기록(direct_failures)의 유효기간.
//
// ■ 왜 필요한가 (2026-08-11 실측)
//
// 상류는 거래처마다 "직결에 실패한 적이 있다"를 파일에 영구 저장하고(peers/<id>.toml 의
// direct_failures), 그 뒤로는 직결 대기창을 CONNECT_TIMEOUT(18초) 대신 punch_time_used*6
// 으로 줄인다. 우리 실측에선 홀펀칭이 189ms 였으니 **18초 창이 1.1초로** 줄어든다.
// 안 되는 상대에게 매번 18초를 버리지 않겠다는 뜻이고, 그 자체는 합리적이다.
//
// 문제는 **되돌아올 길이 없다**는 것이다. 플래그는 직결이 성공해야 0 으로 풀리는데, 창이
// 이미 좁아져 있으니 성공하기 더 어렵다 — 스스로 강화되는 덫이다. 상류는 "거래처의 뚫림
// 여부는 잘 안 변한다"고 가정하지만 우리 쪽은 실제로 변했다:
//   - is_public() 하드코딩 탓에 자체 서버에선 UDP 홀펀치가 꺼져 있었고(1.4.102 에서 켬),
//   - 그 사이 주소를 626.kr 로 이관했다.
// 그때 찍힌 실패가 그대로 남아, 이미 고쳐진 거래처까지 1.1초 창에 갇혀 릴레이만 탄다.
// Chang 맥 실측: 거래처 37곳 중 22곳이 이 상태였다.
//
// ■ 어떻게 푸는가
//
// 플래그를 없애지 않는다(그 최적화는 유효하다). 대신 **마지막 실패로부터 충분히 지나면
// 한 번은 온전한 창을 준다.** 뚫리게 됐으면 그 한 번으로 스스로 0 이 되고, 여전히 안 되면
// 시각이 갱신돼 다시 좁은 창으로 돌아간다. 비용은 "거래처당 유효기간마다 최대 한 번의
// 긴 대기"로 묶인다.
//
// ★기록하는 시각은 "마지막 실패 시각"이 아니라 **"마지막으로 판정한 시각"**이다. 상류는
// direct_failures 값이 **바뀔 때만** 저장한다(client.rs 의 `(direct_failures == 0) != direct`) —
// 이미 1 인 거래처가 또 실패하면 아무것도 안 쓴다. 실패 시각으로 두면 그 뒤로 계속 "오래됐음"
// 이라 매 접속마다 긴 대기를 물게 된다. 온전한 창을 줄 때 그 시각을 찍어야 "유효기간마다
// 최대 한 번"이라는 비용 한도가 실제로 지켜진다.
//
// 시각은 PeerConfig.ui_flutter(문자열 맵)에 넣는다 — hbb_common 은 서브모듈이라 구조체에
// 필드를 더하면 그쪽부터 커밋·푸시해야 하고, 이 값 하나 때문에 그럴 이유가 없다.

use hbb_common::config::PeerConfig;

/// 이 값을 짧게 잡으면 안 뚫리는 거래처에 자주 긴 대기를 물리고, 길게 잡으면 회복이 늦다.
/// 6시간이면 "아침에 한 번, 오후에 한 번" 정도로 재시도하면서 하루 종일 기다리진 않는다.
const RETRY_AFTER_SECS: u64 = 6 * 60 * 60;

const KEY: &str = "cr-direct-fail-at";

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// 판정 시각을 찍는다. 직결이 성공해 플래그가 풀리면 기록도 지운다(다음에 실패하면 새로 찍힌다).
pub fn stamp(config: &mut PeerConfig, keep: bool) {
    if keep {
        config
            .ui_flutter
            .insert(KEY.to_owned(), now_secs().to_string());
    } else {
        config.ui_flutter.remove(KEY);
    }
}

/// 지금 이 거래처에 "온전한 창"을 한 번 줄 때인가.
///   시각이 없으면(옛 설정) 준다 — 언제 실패했는지 모르는 기록은 근거로 쓸 수 없다.
///   시계가 뒤로 간 경우(now < 기록)도 준다. 판단이 애매하면 회복 쪽으로 기운다.
pub fn is_retry_due(config: &PeerConfig) -> bool {
    let Some(at) = config.ui_flutter.get(KEY).and_then(|v| v.parse::<u64>().ok()) else {
        return true;
    };
    let now = now_secs();
    now < at || now - at >= RETRY_AFTER_SECS
}
