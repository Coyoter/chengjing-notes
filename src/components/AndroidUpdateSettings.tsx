import { useEffect, useState } from "react";
import { ExternalLink, Smartphone } from "lucide-react";
import { useI18n } from "../hooks/useI18n";
import { androidUpdateDestination } from "../lib/androidDistribution";
export function AndroidUpdateSettings() {
  const {language}=useI18n();const zh=language.startsWith("zh");const[version,setVersion]=useState("");
  const direct=document.documentElement.dataset.distributionChannel==="direct";
  useEffect(()=>{void window.chengjing?.app.getSystemVersion().then(info=>setVersion(info.version));},[]);
  return <section className="settings-section android-update-settings" id="update-settings"><header><span><Smartphone size={16}/> Android</span><h2>{zh?"版本與更新":"Version and updates"}</h2><p>{!direct?(zh?"此版本由 Google Play 提供更新。":"Updates for this edition are provided by Google Play."):version.includes("-dev")?(zh?"開發測試版。請使用同一來源提供的新安裝檔更新，不需要先移除應用。":"Development build. Update using the next installer from the same source; do not uninstall first."):(zh?"安裝新版本時可保留現有資料。":"Your data can be kept when installing an update.")}</p></header><div className="android-version-row"><span>{zh?"目前版本":"Current version"}</span><b>{version||"…"}</b></div><a className="secondary-button" href={androidUpdateDestination(document.documentElement.dataset.distributionChannel)} target="_blank" rel="noreferrer"><span>{direct?(zh?"查看發布紀錄":"View release history"):(zh?"前往 Google Play":"Open Google Play")}</span><ExternalLink size={15}/></a></section>;
}
