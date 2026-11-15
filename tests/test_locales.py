"""Validate shipped interface translations without network or external services."""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCALES = ROOT / "app" / "static" / "locales"
EXPECTED = {
    "fr", "de", "es", "it", "nl", "pt", "pl",
    "ja", "zh-CN", "zh-TW", "sv", "ko", "ar", "da", "nb",
}
PLACEHOLDER = re.compile(r"\{([A-Za-z_][A-Za-z_0-9]*)\}")


class LocalisationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.keys = json.loads((LOCALES / "keys.json").read_text(encoding="utf-8"))

    def test_all_supported_languages_have_translation_files(self):
        actual = {p.stem for p in LOCALES.glob("*.json") if p.name != "keys.json"}
        self.assertEqual(actual, EXPECTED)

    def test_unique_nonempty_english_keys(self):
        self.assertEqual(len(set(self.keys)), len(self.keys))
        self.assertTrue(all(isinstance(key, str) and key.strip() for key in self.keys))

    def test_all_languages_are_complete(self):
        for code in sorted(EXPECTED):
            with self.subTest(locale=code):
                translations = json.loads((LOCALES / (code + ".json")).read_text(encoding="utf-8"))
                self.assertEqual(set(translations), set(self.keys))
                for source, translated in translations.items():
                    self.assertIsInstance(translated, str)
                    self.assertTrue(translated.strip(), (code, source))
                    self.assertEqual(
                        set(PLACEHOLDER.findall(source)),
                        set(PLACEHOLDER.findall(translated)),
                        (code, source, translated),
                    )

    def test_all_translations_are_valid_utf8(self):
        for path in sorted(LOCALES.glob("*.json")):
            with self.subTest(path=path.name):
                path.read_bytes().decode("utf-8")


if __name__ == "__main__":
    unittest.main()
