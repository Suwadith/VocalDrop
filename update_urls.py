import os

def replace_in_file(path, old, new):
    with open(path, 'r') as f:
        content = f.read()
    content = content.replace(old, new)
    with open(path, 'w') as f:
        f.write(content)

replace_in_file('frontend/src/app/page.tsx', 'http://${window.location.hostname}:8000', '')
replace_in_file('frontend/src/app/player/page.tsx', 'http://${window.location.hostname}:8000', '')
