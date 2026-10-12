#!/usr/bin/env python3
"""
1C BSL AI Copilot VSIX Packager:
Constructs a valid Open Packaging Convention (OPC) .vsix archive
for installation in VS Code, Cursor, Windsurf and publishing to Open-VSX / Marketplace.
"""

import json
import os
import sys
import zipfile

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def build_vsix():
    print(f"Building 1C BSL AI Copilot VSIX from {BASE_DIR}...")
    pkg_path = os.path.join(BASE_DIR, "package.json")
    with open(pkg_path, "r", encoding="utf-8") as f:
        pkg = json.load(f)

    name = pkg.get("name", "1c-bsl-ai-copilot")
    version = pkg.get("version", "1.0.0")
    publisher = pkg.get("publisher", "normahub")
    output_vsix = os.path.join(BASE_DIR, f"{name}-{version}.vsix")
    display_name = pkg.get("displayName", "1C BSL AI Copilot (NormaHub)")
    description = pkg.get("description", "")
    categories = ",".join(pkg.get("categories", ["AI"]))
    tags = ",".join(pkg.get("keywords", ["1c", "bsl", "normahub", "cursor"]))

    content_types_xml = """<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".json" ContentType="application/json"/>
  <Default Extension=".js" ContentType="application/javascript"/>
  <Default Extension=".md" ContentType="text/markdown"/>
  <Default Extension=".png" ContentType="image/png"/>
  <Default Extension=".svg" ContentType="image/svg+xml"/>
  <Default Extension=".vsixmanifest" ContentType="text/xml"/>
</Types>
"""

    vsix_manifest_xml = f"""<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Id="{name}" Version="{version}" Publisher="{publisher}"/>
    <DisplayName>{display_name}</DisplayName>
    <Description>{description}</Description>
    <Icon>extension/icon.png</Icon>
    <Categories>{categories}</Categories>
    <Tags>{tags}</Tags>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="^1.85.0"/>
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value=""/>
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value=""/>
      <Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value=""/>
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code"/>
  </Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/icon.png" Addressable="true"/>
  </Assets>
</PackageManifest>
"""

    files_to_pack = [
        ("package.json", "extension/package.json"),
        ("dist/extension.js", "extension/dist/extension.js"),
        ("dist/mcp-server.js", "extension/dist/mcp-server.js"),
        ("bin/mcp-server-1c.js", "extension/bin/mcp-server-1c.js"),
        ("README.md", "extension/README.md"),
        ("icon.png", "extension/icon.png"),
        ("media/1c-icon.svg", "extension/media/1c-icon.svg"),
        ("epf/NormaHubCopilot_Module.bsl", "extension/epf/NormaHubCopilot_Module.bsl"),
        ("epf/NormaHubCopilot_Form.bsl", "extension/epf/NormaHubCopilot_Form.bsl"),
        ("epf/README.md", "extension/epf/README.md"),
        ("turboconf/normahub_copilot.os", "extension/turboconf/normahub_copilot.os"),
        ("turboconf/README.md", "extension/turboconf/README.md"),
        ("sidecar/core.py", "extension/sidecar/core.py"),
        ("sidecar/server.py", "extension/sidecar/server.py"),
        ("sidecar/config.py", "extension/sidecar/config.py"),
        ("sidecar/main.py", "extension/sidecar/main.py"),
        ("sidecar/clipboard_watcher.py", "extension/sidecar/clipboard_watcher.py"),
        ("sidecar/__init__.py", "extension/sidecar/__init__.py")
    ]

    for src, _ in files_to_pack:
        p = os.path.join(BASE_DIR, src)
        if not os.path.exists(p):
            print(f"Error: Required file missing: {p}", file=sys.stderr)
            sys.exit(1)

    with zipfile.ZipFile(output_vsix, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types_xml)
        zf.writestr("extension.vsixmanifest", vsix_manifest_xml)
        for src, arcname in files_to_pack:
            zf.write(os.path.join(BASE_DIR, src), arcname)

    size_kb = round(os.path.getsize(output_vsix) / 1024, 1)
    print(f"✓ VSIX package successfully built: {output_vsix} ({size_kb} KB)")
    print("\nInstall via Cursor:")
    print(f"  cursor --install-extension {output_vsix}")
    print("\nInstall via VS Code:")
    print(f"  code --install-extension {output_vsix}")

if __name__ == "__main__":
    build_vsix()
