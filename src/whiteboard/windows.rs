use super::{
    server::{Ripple, EVENT_PROXY},
    win_linux::{create_font_face, draw_text},
    Cursor, CustomEvent,
};
use hbb_common::{anyhow::anyhow, log, ResultType};
use softbuffer::{Context, Surface};
use std::{collections::HashMap, num::NonZeroU32, sync::Arc, time::Instant};
use tao::{
    dpi::{PhysicalPosition, PhysicalSize},
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder},
    platform::windows::WindowBuilderExtWindows,
    window::WindowBuilder,
};
use tiny_skia::{Color, FillRule, Paint, PathBuilder, PixmapMut, Stroke, Transform};

pub(super) fn create_event_loop() -> ResultType<()> {
    let face = match create_font_face() {
        Ok(face) => Some(face),
        Err(err) => {
            log::error!("Failed to create font face: {}", err);
            None
        }
    };

    let event_loop = EventLoopBuilder::<(String, CustomEvent)>::with_user_event().build();
    let mut window_builder = WindowBuilder::new()
        .with_title("RustDesk whiteboard")
        .with_transparent(true)
        .with_always_on_top(true)
        .with_skip_taskbar(true)
        .with_decorations(false);

    let mut final_size = None;
    if let Ok((x, y, w, h)) = super::server::get_displays_rect() {
        if w > 0 && h > 0 {
            final_size = Some(PhysicalSize::new(w, h));
            window_builder = window_builder
                .with_position(PhysicalPosition::new(x, y))
                .with_inner_size(PhysicalSize::new(1, 1));
        } else {
            window_builder =
                window_builder.with_fullscreen(Some(tao::window::Fullscreen::Borderless(None)));
        }
    } else {
        window_builder =
            window_builder.with_fullscreen(Some(tao::window::Fullscreen::Borderless(None)));
    }

    let window = Arc::new(window_builder.build::<(String, CustomEvent)>(&event_loop)?);
    window.set_ignore_cursor_events(true)?;

    let context = Context::new(window.clone()).map_err(|e| {
        log::error!("Failed to create context: {}", e);
        anyhow!(e.to_string())
    })?;
    let mut surface = Surface::new(&context, window.clone()).map_err(|e| {
        log::error!("Failed to create surface: {}", e);
        anyhow!(e.to_string())
    })?;

    let proxy = event_loop.create_proxy();
    EVENT_PROXY.write().unwrap().replace(proxy);
    let _call_on_ret = crate::common::SimpleCallOnReturn {
        b: true,
        f: Box::new(move || {
            let _ = EVENT_PROXY.write().unwrap().take();
        }),
    };

    let mut ripples: Vec<Ripple> = Vec::new();
    let mut last_cursors: HashMap<String, Cursor> = HashMap::new();
    let mut resized = final_size.is_none();
    // ChainRemote 마킹 — 획 단위로 쌓아 두고, 마지막으로 그린 뒤 일정 시간이 지나면 지운다.
    //   Chang 지정 규칙: 수동 지우기=즉시 / 가만히 두면 10초 뒤 / 원격 종료 시 즉시(STOP).
    let mut marks: Vec<super::Mark> = Vec::new();
    let mut marks_touched: Option<Instant> = None;

    // 마킹을 그린 뒤 이만큼 손을 놓으면 저절로 사라진다(Chang 지정). 설명이 끝났는데 선이
    //   화면에 남아 가리는 걸 막으면서, 지우려고 매번 버튼을 찾지 않아도 되게 하는 값이다.
    const MARK_TTL: std::time::Duration = std::time::Duration::from_secs(10);

    event_loop.run(move |event, _, control_flow| {
        // ★종전엔 무조건 Poll 이라 아무 일이 없어도 루프가 계속 돌았다(거래처 POS 에서
        //   "리소스를 먹는 것 같다"는 지적의 실체). 애니메이션(물결)이나 만료를 기다릴 게
        //   있을 때만 다음 프레임을 예약하고, 그 밖에는 이벤트가 올 때까지 잔다.
        let animating = !ripples.is_empty() || marks_touched.is_some();
        *control_flow = if animating {
            ControlFlow::WaitUntil(Instant::now() + std::time::Duration::from_millis(16))
        } else {
            ControlFlow::Wait
        };

        match event {
            Event::WindowEvent { event, .. } => match event {
                WindowEvent::CloseRequested => {
                    *control_flow = ControlFlow::Exit;
                }
                _ => {}
            },
            Event::RedrawRequested(_) => {
                if !resized {
                    if let Some(size) = final_size.take() {
                        window.set_inner_size(size);
                    }
                    resized = true;
                    return;
                }

                let (width, height) = {
                    let size = window.inner_size();
                    (size.width, size.height)
                };

                let (Some(width), Some(height)) = (NonZeroU32::new(width), NonZeroU32::new(height))
                else {
                    return;
                };
                if let Err(e) = surface.resize(width, height) {
                    log::error!("Failed to resize surface: {}", e);
                    return;
                }

                let mut buffer = match surface.buffer_mut() {
                    Ok(buf) => buf,
                    Err(e) => {
                        log::error!("Failed to get buffer: {}", e);
                        return;
                    }
                };
                let Some(mut pixmap) = PixmapMut::from_bytes(
                    bytemuck::cast_slice_mut(&mut buffer),
                    width.get(),
                    height.get(),
                ) else {
                    log::error!("Failed to create pixmap from buffer");
                    return;
                };
                pixmap.fill(Color::TRANSPARENT);

                Ripple::retain_active(&mut ripples);
                for ripple in &ripples {
                    let (radius, alpha) = ripple.get_radius_alpha();

                    let mut ripple_paint = Paint::default();
                    // Note: The real color is bgra here.
                    ripple_paint.set_color_rgba8(64, 64, 255, (alpha * 128.0) as u8);
                    ripple_paint.anti_alias = true;

                    let mut ripple_pb = PathBuilder::new();
                    ripple_pb.push_circle(ripple.x, ripple.y, radius);
                    if let Some(path) = ripple_pb.finish() {
                        pixmap.fill_path(
                            &path,
                            &ripple_paint,
                            FillRule::Winding,
                            Transform::identity(),
                            None,
                        );
                    }
                }

                // 마킹 — 커서보다 먼저 그려 커서 화살표가 선 위에 오게 한다.
                for mark in &marks {
                    if mark.points.len() < 2 {
                        // 점 하나짜리 획은 선으로 못 그린다 — 작은 점으로 찍어 준다.
                        if let Some(&(x, y)) = mark.points.first() {
                            let mut pb = PathBuilder::new();
                            pb.push_circle(x, y, (mark.width / 2.0).max(1.0));
                            if let Some(path) = pb.finish() {
                                let rgba = super::argb_to_rgba(mark.argb);
                                let mut paint = Paint::default();
                                // Note: The real color is bgra here.
                                paint.set_color_rgba8(rgba.2, rgba.1, rgba.0, rgba.3);
                                paint.anti_alias = true;
                                pixmap.fill_path(
                                    &path,
                                    &paint,
                                    FillRule::Winding,
                                    Transform::identity(),
                                    None,
                                );
                            }
                        }
                        continue;
                    }
                    let mut pb = PathBuilder::new();
                    pb.move_to(mark.points[0].0, mark.points[0].1);
                    for p in &mark.points[1..] {
                        pb.line_to(p.0, p.1);
                    }
                    if let Some(path) = pb.finish() {
                        let rgba = super::argb_to_rgba(mark.argb);
                        let mut paint = Paint::default();
                        // Note: The real color is bgra here.
                        paint.set_color_rgba8(rgba.2, rgba.1, rgba.0, rgba.3);
                        paint.anti_alias = true;
                        let mut stroke = Stroke::default();
                        stroke.width = mark.width.max(1.0);
                        stroke.line_cap = tiny_skia::LineCap::Round;
                        stroke.line_join = tiny_skia::LineJoin::Round;
                        pixmap.stroke_path(&path, &paint, &stroke, Transform::identity(), None);
                    }
                }

                for cursor in last_cursors.values() {
                    let (x, y) = (cursor.x, cursor.y);
                    let size = 1.5f32;

                    let mut pb = PathBuilder::new();
                    pb.move_to(x, y);
                    pb.line_to(x, y + 16.0 * size);
                    pb.line_to(x + 4.0 * size, y + 13.0 * size);
                    pb.line_to(x + 7.0 * size, y + 20.0 * size);
                    pb.line_to(x + 9.0 * size, y + 19.0 * size);
                    pb.line_to(x + 6.0 * size, y + 12.0 * size);
                    pb.line_to(x + 11.0 * size, y + 12.0 * size);
                    pb.close();

                    if let Some(path) = pb.finish() {
                        let rgba = super::argb_to_rgba(cursor.argb);
                        let mut arrow_paint = Paint::default();
                        // Note: The real color is bgra here.
                        arrow_paint.set_color_rgba8(rgba.2, rgba.1, rgba.0, rgba.3);
                        arrow_paint.anti_alias = true;
                        pixmap.fill_path(
                            &path,
                            &arrow_paint,
                            FillRule::Winding,
                            Transform::identity(),
                            None,
                        );

                        let mut black_paint = Paint::default();
                        black_paint.set_color_rgba8(0, 0, 0, 255);
                        black_paint.anti_alias = true;
                        let mut stroke = Stroke::default();
                        stroke.width = 1.0f32;
                        pixmap.stroke_path(
                            &path,
                            &black_paint,
                            &stroke,
                            Transform::identity(),
                            None,
                        );

                        face.as_ref().map(|face| {
                            draw_text(
                                &mut pixmap,
                                face,
                                &cursor.text,
                                x + 24.0 * size,
                                y + 24.0 * size,
                                &arrow_paint,
                                14.0f32,
                            );
                        });
                    }
                }

                if let Err(e) = buffer.present() {
                    log::error!("Failed to present surface: {}", e);
                    return;
                }
            }
            Event::MainEventsCleared => {
                // 손을 놓은 지 MARK_TTL 이 지나면 마킹을 걷는다.
                if let Some(t) = marks_touched {
                    if t.elapsed() >= MARK_TTL {
                        marks.clear();
                        marks_touched = None;
                    }
                }
                window.request_redraw();
            }
            Event::UserEvent((k, evt)) => match evt {
                CustomEvent::Cursor(cursor) => {
                    if cursor.btns != 0 {
                        ripples.push(Ripple {
                            x: cursor.x,
                            y: cursor.y,
                            start_time: Instant::now(),
                        });
                    }
                    last_cursors.insert(k, cursor);
                }
                CustomEvent::Mark(mark) => {
                    // 직전 획이 아직 안 끝났으면 그 획에 점을 잇는다(뷰어가 묶어 보내므로).
                    let append = marks
                        .last()
                        .map(|m: &super::Mark| !m.end_stroke && m.argb == mark.argb)
                        .unwrap_or(false);
                    if append {
                        if let Some(last) = marks.last_mut() {
                            last.points.extend_from_slice(&mark.points);
                            last.end_stroke = mark.end_stroke;
                        }
                    } else if !mark.points.is_empty() {
                        marks.push(mark);
                    }
                    marks_touched = Some(Instant::now());
                }
                CustomEvent::Clear => {
                    marks.clear();
                    marks_touched = None;
                }
                CustomEvent::Exit => {
                    *control_flow = ControlFlow::Exit;
                }
            },
            _ => (),
        }
    });
}
