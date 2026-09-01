# Connect the Lens to a real SO-101

## Path

`SO-101 ↔ USB ↔ so101_bridge.py ↔ local_wss_helper.py ↔ Wi-Fi ↔ Spectacles`

## Prerequisites

- Assembled, calibrated SO-101 · USB logic + servo power.
- macOS · Python 3.11 · same non-isolated Wi-Fi.
- TCP 8443 allowed locally · clear workspace · power disconnect.

## One-time installation

```bash
git clone https://github.com/a-sumo/so101-helper.git
cd so101-helper
python3.11 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements-bridge.txt
```

Serial device, if needed:

```bash
ls /dev/cu.usbmodem* /dev/cu.usbserial*
```

Enroll:

```bash
.venv/bin/python bridge/local_wss_helper.py setup --email owner@example.com
```

Rerun `setup` after a LAN address change.

## First pairing

Terminal 1:

```bash
.venv/bin/python so101_bridge.py
```

Port override:

```bash
.venv/bin/python so101_bridge.py --port /dev/cu.usbmodemXXXX
```

Check:

```bash
curl http://127.0.0.1:8097/health
```

Expect: `"status":"ok"` · `"dry_run":false`.

Terminal 2:

```bash
.venv/bin/python bridge/local_wss_helper.py serve --pair
```

Lens PIN: Terminal 2's 8 digits.

Terminal 1:

```text
ARM
```

Terminal 2:

```text
so101-helper> enable
```

Lens: **Operate → Real arm → ARM LIVE**. Start small. Match arm / twin direction.

## Later sessions

Terminal 1 + Terminal 2:

```bash
# Terminal 1
.venv/bin/python so101_bridge.py

# Terminal 2
.venv/bin/python bridge/local_wss_helper.py serve
```

Repeat `ARM` + `enable` each session.

Console:

- `enable` / `disable`
- `pair`
- `status`
- `reset-pairings`
- `quit`

## Troubleshooting

- **No PIN:** physical Spectacles + current Lens.
- **Rejected code:** `pair` → enter new code.
- **No helper:** same LAN · TCP 8443.
- **No Real arm:** `ARM` · health check · not dry-run.
- **New LAN:** rerun `setup --email …`.
- **Stop:** `disable` → stop helper + bridge.
