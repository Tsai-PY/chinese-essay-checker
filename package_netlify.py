import os
import shutil
import zipfile

src_dir = os.path.abspath('public')
dist_dir = os.path.abspath(os.path.join('..', 'chinese-essay-checker-netlify'))
zip_in_repo = os.path.abspath('chinese-essay-checker-netlify.zip')
zip_in_parent = os.path.abspath(os.path.join('..', 'chinese-essay-checker-netlify.zip'))

print(f"1. 正在同步靜態資料夾到: {dist_dir}")
if os.path.exists(dist_dir):
    shutil.rmtree(dist_dir)
shutil.copytree(src_dir, dist_dir)

print(f"2. 正在以標準 POSIX 格式打包 ZIP: {zip_in_repo}")
if os.path.exists(zip_in_repo):
    os.remove(zip_in_repo)

with zipfile.ZipFile(zip_in_repo, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
    for root, dirs, files in os.walk(src_dir):
        for file in files:
            full_path = os.path.join(root, file)
            rel_path = os.path.relpath(full_path, src_dir).replace('\\', '/')
            zf.write(full_path, arcname=rel_path)

shutil.copyfile(zip_in_repo, zip_in_parent)

print("\n--- ZIP Contents ---")
with zipfile.ZipFile(zip_in_repo, 'r') as zf:
    for info in zf.infolist():
        print(f"  - {info.filename} ({info.file_size} bytes)")

print("\nPackaged successfully:")
print(f"  1. Dist folder: {dist_dir}")
print(f"  2. Zip parent:  {zip_in_parent}")
print(f"  3. Zip repo:    {zip_in_repo}")
