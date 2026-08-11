#!/usr/bin/env sh
set -u

base="/mnt/c/LAB/HEIMDALL/api/packages"
report="/mnt/c/LAB/HEIMDALL/api/package-download-results.csv"

mkdir -p "$base/2.5" "$base/2.6" "$base/2.7" "$base/2.8"
printf "Status,VersionDir,File,Bytes,Url\n" > "$report"

download() {
  dir="$1"
  tag="$2"
  file="$3"
  url="https://github.com/pfrest/pfSense-pkg-RESTAPI/releases/download/${tag}/${file}"
  dest="${base}/${dir}/${file}"

  if [ ! -s "$dest" ]; then
    if ! curl -fL --connect-timeout 20 --retry 2 -o "$dest" "$url"; then
      rm -f "$dest"
      printf "FAIL,%s,%s,0,%s\n" "$dir" "$file" "$url" | tee -a "$report"
      return
    fi
  fi

  bytes="$(wc -c < "$dest" | tr -d " ")"
  printf "OK,%s,%s,%s,%s\n" "$dir" "$file" "$bytes" "$url" | tee -a "$report"
}

download 2.5 v1.5.4 pfSense-2.5-pkg-API.txz
download 2.6 v1.5.4 pfSense-2.6-pkg-API.txz
download 2.7 v1.9.0 pfSense-2.7-pkg-API.pkg
download 2.7 v2.4.3 pfSense-2.7.2-pkg-RESTAPI.pkg
download 2.8 v2.7.7 pfSense-2.8.0-pkg-RESTAPI.pkg
download 2.8 v2.10.0 pfSense-2.8.1-pkg-RESTAPI.pkg
download 2.8 v2.10.0 pfSense-25.11.1-pkg-RESTAPI.pkg
download 2.8 v2.10.0 pfSense-26.03-pkg-RESTAPI.pkg
download 2.8 v2.10.0 pfSense-26.03.1-pkg-RESTAPI.pkg

echo "Relatorio: $report"
