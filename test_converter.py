from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from PIL import Image

from image_converter import ConversionOptions, convert_image, discover_images, output_path_for


class ConverterTests(unittest.TestCase):
    def test_discovers_supported_images_and_preserves_relative_output(self) -> None:
        with TemporaryDirectory() as directory:
            source = Path(directory) / "source"
            nested = source / "nested"
            nested.mkdir(parents=True)
            Image.new("RGB", (30, 20), "red").save(source / "photo.jpg")
            Image.new("RGBA", (30, 20), (0, 0, 0, 0)).save(nested / "logo.png")
            (source / "notes.txt").write_text("ignore me", encoding="utf-8")

            images = discover_images(source, recursive=True)
            self.assertEqual(len(images), 2)

            options = ConversionOptions(source, Path(directory) / "out", 82, 100, True, False)
            self.assertEqual(output_path_for(nested / "logo.png", options), options.output / "nested/logo.webp")

    def test_converts_and_resizes_to_webp(self) -> None:
        with TemporaryDirectory() as directory:
            source = Path(directory) / "source.png"
            destination = Path(directory) / "out" / "source.webp"
            Image.new("RGB", (100, 80), "blue").save(source)

            original_size, new_size = convert_image(source, destination, quality=80, scale=50)

            self.assertGreater(original_size, 0)
            self.assertGreater(new_size, 0)
            with Image.open(destination) as converted:
                self.assertEqual(converted.format, "WEBP")
                self.assertEqual(converted.size, (50, 40))


if __name__ == "__main__":
    unittest.main()
