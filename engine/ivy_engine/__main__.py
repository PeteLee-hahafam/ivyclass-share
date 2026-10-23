"""실행: python -m ivy_engine  (run_engine.bat 이 ivy_engine.launcher 를 거쳐 이걸 실행해요)"""

import argparse
import sys
import threading
import time


def main():
    ap = argparse.ArgumentParser(description='학원 강의 제작 엔진')
    ap.add_argument('--no-browser', action='store_true', help='설정 화면을 자동으로 열지 않아요')
    ap.add_argument('--once', action='store_true', help='작업 하나만 처리하고 끝내요 (점검용)')
    ap.add_argument('--connect', metavar='CODE', help='강의실 연결 코드를 저장해요 (설치 파일이 써요)')
    ap.add_argument('--autostart', action='store_true', help='윈도우를 켜면 엔진도 켜지게 해요')
    ap.add_argument('--setup-only', action='store_true', help='설정만 저장하고 끝내요')
    args = ap.parse_args()
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding='utf-8', errors='replace')
        except Exception:
            pass

    from . import VERSION, config
    from .webui import UI, set_autostart
    from .worker import Engine

    if args.connect:
        config.parse_connection(args.connect)
        s = config.load()
        s['connection'] = args.connect.strip()
        config.save(s)
        print('강의실 연결 코드를 저장했어요.')
    if args.autostart:
        try:
            set_autostart(True)
            print('윈도우를 켜면 엔진도 자동으로 켜져요.')
        except Exception as e:
            print(f'자동 시작을 켜지 못했어요: {e}')
    if args.setup_only:
        return

    eng = Engine()
    ui = UI(eng)
    ui.start(open_browser=(not args.no_browser) or not eng.settings.get('connection'))
    print('=' * 60)
    print(f' 강의 제작 엔진 {VERSION}')
    print(f' 설정 화면: {ui.url}')
    print(' 이 창을 닫으면 엔진이 멈춰요. 최소화해 두세요.')
    print('=' * 60, flush=True)
    if args.once:
        start = eng.done_count
        t = threading.Thread(target=eng.run, daemon=True)
        t.start()
        while eng.done_count == start and t.is_alive():
            time.sleep(1)
        return
    t = threading.Thread(target=eng.run, daemon=True)
    t.start()
    try:
        while t.is_alive():
            t.join(1)
    except KeyboardInterrupt:
        eng.stop_ev.set()
        eng.wake_ev.set()
        print('엔진을 멈췄어요.')
        return
    sys.exit(eng.exit_code or 0)


if __name__ == '__main__':
    main()
