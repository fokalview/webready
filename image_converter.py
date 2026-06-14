from __future__ import annotations

import os
import queue
import subprocess
import threading
from dataclasses import dataclass
from pathlib import Path
from tkinter import filedialog, messagebox
import tkinter as tk
from tkinter import ttk

from PIL import Image, ImageOps


APP_NAME = "WebReady"
SUPPORTED_EXTENSIONS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".bmp",
    ".gif",
    ".tif",
    ".tiff",
    ".webp",
}


@dataclass
class ConversionOptions:
    source: Path
    output: Path
    quality: int
    scale: int
    recursive: bool
    overwrite: bool


def discover_images(source: Path, recursive: bool) -> list[Path]:
    if source.is_file():
        return [source] if source.suffix.lower() in SUPPORTED_EXTENSIONS else []

    iterator = source.rglob("*") if recursive else source.glob("*")
    return sorted(
        path for path in iterator if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS
    )


def output_path_for(image_path: Path, options: ConversionOptions) -> Path:
    if options.source.is_file():
        relative = Path(image_path.name)
    else:
        relative = image_path.relative_to(options.source)
    return options.output / relative.with_suffix(".webp")


def convert_image(image_path: Path, destination: Path, quality: int, scale: int) -> tuple[int, int]:
    original_size = image_path.stat().st_size
    destination.parent.mkdir(parents=True, exist_ok=True)

    with Image.open(image_path) as source_image:
        image = ImageOps.exif_transpose(source_image)
        if getattr(image, "is_animated", False):
            image.seek(0)
        image.load()

        if scale != 100:
            width = max(1, round(image.width * scale / 100))
            height = max(1, round(image.height * scale / 100))
            image = image.resize((width, height), Image.Resampling.LANCZOS)

        if image.mode not in ("RGB", "RGBA"):
            image = image.convert("RGBA" if "transparency" in image.info else "RGB")

        image.save(
            destination,
            "WEBP",
            quality=quality,
            method=6,
            optimize=True,
        )

    return original_size, destination.stat().st_size


class WebReadyApp(tk.Tk):
    BG = "#0b1220"
    PANEL = "#111c2e"
    PANEL_LIGHT = "#18263c"
    TEXT = "#f4f7fb"
    MUTED = "#98a7ba"
    ACCENT = "#5ce1a9"
    ACCENT_DARK = "#102c28"
    BORDER = "#263852"
    ERROR = "#ff8b8b"

    def __init__(self) -> None:
        super().__init__()
        self.title(f"{APP_NAME} - Website Image Converter")
        self.geometry("920x690")
        self.minsize(780, 620)
        self.configure(bg=self.BG)

        self.source_var = tk.StringVar()
        self.output_var = tk.StringVar()
        self.quality_var = tk.IntVar(value=82)
        self.scale_var = tk.IntVar(value=100)
        self.recursive_var = tk.BooleanVar(value=True)
        self.overwrite_var = tk.BooleanVar(value=False)
        self.status_var = tk.StringVar(value="Choose an image or folder to begin.")
        self.summary_var = tk.StringVar(value="")
        self.events: queue.Queue[tuple[str, object]] = queue.Queue()
        self.worker: threading.Thread | None = None

        self._configure_styles()
        self._build_ui()
        self.after(100, self._process_events)

    def _configure_styles(self) -> None:
        style = ttk.Style(self)
        style.theme_use("clam")
        style.configure(
            "TProgressbar",
            troughcolor=self.PANEL_LIGHT,
            background=self.ACCENT,
            bordercolor=self.PANEL_LIGHT,
            lightcolor=self.ACCENT,
            darkcolor=self.ACCENT,
            thickness=12,
        )

    def _build_ui(self) -> None:
        outer = tk.Frame(self, bg=self.BG, padx=38, pady=30)
        outer.pack(fill="both", expand=True)

        header = tk.Frame(outer, bg=self.BG)
        header.pack(fill="x", pady=(0, 22))
        tk.Label(
            header,
            text=APP_NAME,
            bg=self.BG,
            fg=self.ACCENT,
            font=("Segoe UI Semibold", 25),
        ).pack(anchor="w")
        tk.Label(
            header,
            text="Turn website images into fast, lightweight WebP files.",
            bg=self.BG,
            fg=self.TEXT,
            font=("Segoe UI", 13),
        ).pack(anchor="w", pady=(3, 0))

        card = tk.Frame(
            outer,
            bg=self.PANEL,
            highlightbackground=self.BORDER,
            highlightthickness=1,
            padx=24,
            pady=22,
        )
        card.pack(fill="x")

        self._path_row(card, "Source image or folder", self.source_var, self._browse_source)
        self._path_row(card, "Output folder", self.output_var, self._browse_output, top=16)

        controls = tk.Frame(card, bg=self.PANEL)
        controls.pack(fill="x", pady=(22, 4))
        self._slider_control(
            controls,
            "WebP quality",
            "82 is a strong balance for most websites.",
            self.quality_var,
            20,
            100,
            0,
        )
        self._slider_control(
            controls,
            "Image size",
            "Resize dimensions to this percentage.",
            self.scale_var,
            10,
            100,
            1,
        )

        toggles = tk.Frame(card, bg=self.PANEL)
        toggles.pack(fill="x", pady=(18, 0))
        self._checkbutton(toggles, "Include subfolders", self.recursive_var).pack(side="left")
        self._checkbutton(toggles, "Overwrite existing WebP files", self.overwrite_var).pack(
            side="left", padx=(26, 0)
        )

        action_row = tk.Frame(outer, bg=self.BG)
        action_row.pack(fill="x", pady=(18, 14))
        self.convert_button = tk.Button(
            action_row,
            text="Convert to WebP",
            command=self._start_conversion,
            bg=self.ACCENT,
            fg="#071710",
            activebackground="#7aebbd",
            activeforeground="#071710",
            relief="flat",
            bd=0,
            cursor="hand2",
            font=("Segoe UI Semibold", 11),
            padx=24,
            pady=11,
        )
        self.convert_button.pack(side="left")
        self.open_button = tk.Button(
            action_row,
            text="Open output folder",
            command=self._open_output,
            bg=self.PANEL_LIGHT,
            fg=self.TEXT,
            activebackground=self.BORDER,
            activeforeground=self.TEXT,
            relief="flat",
            bd=0,
            cursor="hand2",
            font=("Segoe UI Semibold", 10),
            padx=18,
            pady=11,
        )
        self.open_button.pack(side="left", padx=(10, 0))

        progress_card = tk.Frame(
            outer,
            bg=self.PANEL,
            highlightbackground=self.BORDER,
            highlightthickness=1,
            padx=20,
            pady=16,
        )
        progress_card.pack(fill="both", expand=True)
        tk.Label(
            progress_card,
            textvariable=self.status_var,
            bg=self.PANEL,
            fg=self.TEXT,
            font=("Segoe UI Semibold", 10),
        ).pack(anchor="w")
        self.progress = ttk.Progressbar(progress_card, mode="determinate")
        self.progress.pack(fill="x", pady=(10, 8))
        tk.Label(
            progress_card,
            textvariable=self.summary_var,
            bg=self.PANEL,
            fg=self.ACCENT,
            font=("Segoe UI", 9),
        ).pack(anchor="w", pady=(0, 8))
        self.log = tk.Text(
            progress_card,
            height=8,
            bg="#0c1626",
            fg=self.MUTED,
            insertbackground=self.TEXT,
            selectbackground=self.BORDER,
            relief="flat",
            bd=0,
            font=("Consolas", 9),
            padx=10,
            pady=8,
            state="disabled",
        )
        self.log.pack(fill="both", expand=True)

    def _path_row(
        self,
        parent: tk.Widget,
        label: str,
        variable: tk.StringVar,
        command,
        top: int = 0,
    ) -> None:
        row = tk.Frame(parent, bg=self.PANEL)
        row.pack(fill="x", pady=(top, 0))
        tk.Label(
            row,
            text=label,
            bg=self.PANEL,
            fg=self.TEXT,
            font=("Segoe UI Semibold", 10),
        ).pack(anchor="w", pady=(0, 7))
        entry_row = tk.Frame(row, bg=self.PANEL)
        entry_row.pack(fill="x")
        entry = tk.Entry(
            entry_row,
            textvariable=variable,
            bg=self.PANEL_LIGHT,
            fg=self.TEXT,
            insertbackground=self.TEXT,
            relief="flat",
            bd=0,
            font=("Segoe UI", 10),
        )
        entry.pack(side="left", fill="x", expand=True, ipady=9, ipadx=10)
        tk.Button(
            entry_row,
            text="Browse",
            command=command,
            bg=self.BORDER,
            fg=self.TEXT,
            activebackground="#345070",
            activeforeground=self.TEXT,
            relief="flat",
            bd=0,
            cursor="hand2",
            font=("Segoe UI Semibold", 9),
            padx=16,
            pady=9,
        ).pack(side="left", padx=(8, 0))

    def _slider_control(
        self,
        parent: tk.Widget,
        title: str,
        subtitle: str,
        variable: tk.IntVar,
        minimum: int,
        maximum: int,
        column: int,
    ) -> None:
        panel = tk.Frame(parent, bg=self.PANEL_LIGHT, padx=16, pady=13)
        panel.grid(row=0, column=column, sticky="nsew", padx=(0, 8) if column == 0 else (8, 0))
        parent.grid_columnconfigure(column, weight=1)
        top = tk.Frame(panel, bg=self.PANEL_LIGHT)
        top.pack(fill="x")
        tk.Label(
            top, text=title, bg=self.PANEL_LIGHT, fg=self.TEXT, font=("Segoe UI Semibold", 10)
        ).pack(side="left")
        tk.Label(
            top,
            textvariable=variable,
            bg=self.ACCENT_DARK,
            fg=self.ACCENT,
            font=("Segoe UI Semibold", 10),
            padx=8,
            pady=2,
        ).pack(side="right")
        tk.Scale(
            panel,
            variable=variable,
            from_=minimum,
            to=maximum,
            orient="horizontal",
            showvalue=False,
            bg=self.PANEL_LIGHT,
            fg=self.TEXT,
            activebackground=self.ACCENT,
            troughcolor=self.BORDER,
            highlightthickness=0,
            bd=0,
            sliderrelief="flat",
        ).pack(fill="x", pady=(8, 2))
        tk.Label(
            panel, text=subtitle, bg=self.PANEL_LIGHT, fg=self.MUTED, font=("Segoe UI", 8)
        ).pack(anchor="w")

    def _checkbutton(self, parent: tk.Widget, text: str, variable: tk.BooleanVar) -> tk.Checkbutton:
        return tk.Checkbutton(
            parent,
            text=text,
            variable=variable,
            bg=self.PANEL,
            fg=self.MUTED,
            activebackground=self.PANEL,
            activeforeground=self.TEXT,
            selectcolor=self.PANEL_LIGHT,
            font=("Segoe UI", 9),
            bd=0,
            highlightthickness=0,
        )

    def _browse_source(self) -> None:
        folder = filedialog.askdirectory(title="Choose a folder of images")
        if folder:
            self.source_var.set(folder)
            if not self.output_var.get():
                self.output_var.set(str(Path(folder) / "webp-output"))

    def _browse_output(self) -> None:
        folder = filedialog.askdirectory(title="Choose an output folder")
        if folder:
            self.output_var.set(folder)

    def _start_conversion(self) -> None:
        source = Path(self.source_var.get().strip().strip('"')).expanduser()
        if not source.exists():
            messagebox.showerror(APP_NAME, "Choose a valid source image or folder.")
            return

        output_text = self.output_var.get().strip().strip('"')
        if not output_text:
            output = source.parent / f"{source.stem}-webp" if source.is_file() else source / "webp-output"
            self.output_var.set(str(output))
        else:
            output = Path(output_text).expanduser()

        options = ConversionOptions(
            source=source.resolve(),
            output=output.resolve(),
            quality=self.quality_var.get(),
            scale=self.scale_var.get(),
            recursive=self.recursive_var.get(),
            overwrite=self.overwrite_var.get(),
        )

        self.convert_button.configure(state="disabled", text="Converting...")
        self.progress["value"] = 0
        self.summary_var.set("")
        self._clear_log()
        self.worker = threading.Thread(target=self._convert_worker, args=(options,), daemon=True)
        self.worker.start()

    def _convert_worker(self, options: ConversionOptions) -> None:
        images = [
            path
            for path in discover_images(options.source, options.recursive)
            if options.output not in path.parents
        ]
        self.events.put(("start", len(images)))
        if not images:
            self.events.put(("done", (0, 0, 0, 0)))
            return

        converted = skipped = failed = original_total = new_total = 0
        for index, image_path in enumerate(images, start=1):
            destination = output_path_for(image_path, options)
            if destination.exists() and not options.overwrite:
                skipped += 1
                self.events.put(("log", f"Skipped existing: {destination.name}"))
            else:
                try:
                    old_size, new_size = convert_image(
                        image_path, destination, options.quality, options.scale
                    )
                    converted += 1
                    original_total += old_size
                    new_total += new_size
                    self.events.put(("log", f"Converted: {image_path.name}"))
                except Exception as exc:
                    failed += 1
                    self.events.put(("error", f"Failed: {image_path.name} ({exc})"))
            self.events.put(("progress", (index, len(images))))

        self.events.put(("done", (converted, skipped, failed, original_total - new_total)))

    def _process_events(self) -> None:
        try:
            while True:
                event, payload = self.events.get_nowait()
                if event == "start":
                    total = int(payload)
                    self.progress["maximum"] = max(total, 1)
                    self.status_var.set(f"Found {total} image{'s' if total != 1 else ''}.")
                elif event == "progress":
                    current, total = payload
                    self.progress["value"] = current
                    self.status_var.set(f"Converting image {current} of {total}...")
                elif event == "log":
                    self._append_log(str(payload), self.MUTED)
                elif event == "error":
                    self._append_log(str(payload), self.ERROR)
                elif event == "done":
                    converted, skipped, failed, saved = payload
                    self.convert_button.configure(state="normal", text="Convert to WebP")
                    self.status_var.set("Conversion complete." if converted else "Nothing was converted.")
                    saved_text = self._format_bytes(saved) if saved > 0 else "0 B"
                    self.summary_var.set(
                        f"{converted} converted  |  {skipped} skipped  |  {failed} failed  |  {saved_text} saved"
                    )
        except queue.Empty:
            pass
        self.after(100, self._process_events)

    def _append_log(self, message: str, color: str) -> None:
        self.log.configure(state="normal")
        tag = f"color-{color}"
        self.log.tag_configure(tag, foreground=color)
        self.log.insert("end", message + "\n", tag)
        self.log.see("end")
        self.log.configure(state="disabled")

    def _clear_log(self) -> None:
        self.log.configure(state="normal")
        self.log.delete("1.0", "end")
        self.log.configure(state="disabled")

    def _open_output(self) -> None:
        output = Path(self.output_var.get().strip().strip('"'))
        if output.exists():
            os.startfile(output)  # type: ignore[attr-defined]
        else:
            messagebox.showinfo(APP_NAME, "The output folder does not exist yet.")

    @staticmethod
    def _format_bytes(value: int) -> str:
        amount = float(value)
        for unit in ("B", "KB", "MB", "GB"):
            if abs(amount) < 1024 or unit == "GB":
                return f"{amount:.1f} {unit}"
            amount /= 1024
        return f"{amount:.1f} GB"


if __name__ == "__main__":
    WebReadyApp().mainloop()
