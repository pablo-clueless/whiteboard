//! Who's on the other end of a request: IP, browser, device and locale, for sessions, analytics
//! and the audit log.

use std::{convert::Infallible, net::SocketAddr};

use axum::{
    extract::{ConnectInfo, FromRequestParts},
    http::{HeaderMap, header, request::Parts},
};
use serde::Serialize;

use crate::AppState;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Browser {
    Chrome,
    Firefox,
    Safari,
    Edge,
    Others,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Device {
    Desktop,
    Tablet,
    Mobile,
}

impl Browser {
    /// Matches the order browsers copy each other's tokens: Edge says Chrome and Safari, Chrome
    /// says Safari.
    pub fn from_user_agent(ua: &str) -> Self {
        if ua.contains("Edg/") || ua.contains("EdgA/") || ua.contains("EdgiOS/") {
            Self::Edge
        } else if ua.contains("OPR/") || ua.contains("SamsungBrowser/") {
            Self::Others
        } else if ua.contains("Firefox/") || ua.contains("FxiOS/") {
            Self::Firefox
        } else if ua.contains("Chrome/") || ua.contains("CriOS/") || ua.contains("Chromium/") {
            Self::Chrome
        } else if ua.contains("Safari/") {
            Self::Safari
        } else {
            Self::Others
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Chrome => "chrome",
            Self::Firefox => "firefox",
            Self::Safari => "safari",
            Self::Edge => "edge",
            Self::Others => "others",
        }
    }
}

impl Device {
    pub fn from_user_agent(ua: &str) -> Self {
        if ua.contains("iPad") || ua.contains("Tablet") || (ua.contains("Android") && !ua.contains("Mobile"))
        {
            Self::Tablet
        } else if ua.contains("Mobi") || ua.contains("iPhone") || ua.contains("Android") {
            Self::Mobile
        } else {
            Self::Desktop
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Desktop => "desktop",
            Self::Tablet => "tablet",
            Self::Mobile => "mobile",
        }
    }
}

#[derive(Debug, Clone)]
pub struct RequestMeta {
    pub ip: Option<String>,
    pub user_agent: String,
    pub browser: Browser,
    pub device: Device,
    /// First language tag of Accept-Language, e.g. "en-GB".
    pub locale: Option<String>,
}

impl RequestMeta {
    pub fn from_parts(headers: &HeaderMap, peer: Option<SocketAddr>, trust_proxy: bool) -> Self {
        let forwarded = trust_proxy
            .then(|| headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()))
            .flatten()
            .and_then(|v| v.split(',').next())
            .map(|ip| ip.trim().to_owned())
            .filter(|ip| !ip.is_empty());
        let ip = forwarded.or_else(|| peer.map(|p| p.ip().to_string()));
        let user_agent =
            headers.get(header::USER_AGENT).and_then(|v| v.to_str().ok()).unwrap_or_default().to_owned();
        let locale = headers
            .get(header::ACCEPT_LANGUAGE)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.split([',', ';']).next())
            .map(|l| l.trim().to_owned())
            .filter(|l| !l.is_empty() && l != "*");
        Self {
            ip,
            browser: Browser::from_user_agent(&user_agent),
            device: Device::from_user_agent(&user_agent),
            user_agent,
            locale,
        }
    }
}

impl FromRequestParts<AppState> for RequestMeta {
    type Rejection = Infallible;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let peer = parts.extensions.get::<ConnectInfo<SocketAddr>>().map(|c| c.0);
        Ok(Self::from_parts(&parts.headers, peer, state.config.trust_proxy))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CHROME_MAC: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
    const EDGE_WIN: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0";
    const SAFARI_IPHONE: &str = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
    const FIREFOX_ANDROID_TABLET: &str =
        "Mozilla/5.0 (Android 14; Tablet; rv:130.0) Gecko/130.0 Firefox/130.0";

    #[test]
    fn classifies_common_user_agents() {
        assert_eq!(Browser::from_user_agent(CHROME_MAC), Browser::Chrome);
        assert_eq!(Browser::from_user_agent(EDGE_WIN), Browser::Edge);
        assert_eq!(Browser::from_user_agent(SAFARI_IPHONE), Browser::Safari);
        assert_eq!(Browser::from_user_agent(FIREFOX_ANDROID_TABLET), Browser::Firefox);
        assert_eq!(Browser::from_user_agent("curl/8.0"), Browser::Others);
        assert_eq!(Device::from_user_agent(CHROME_MAC), Device::Desktop);
        assert_eq!(Device::from_user_agent(SAFARI_IPHONE), Device::Mobile);
        assert_eq!(Device::from_user_agent(FIREFOX_ANDROID_TABLET), Device::Tablet);
    }

    #[test]
    fn only_trusts_forwarded_for_when_told_to() {
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-for", "203.0.113.7, 10.0.0.1".parse().unwrap());
        headers.insert(header::ACCEPT_LANGUAGE, "en-GB,en;q=0.9".parse().unwrap());
        let peer = Some("127.0.0.1:5000".parse().unwrap());
        assert_eq!(RequestMeta::from_parts(&headers, peer, true).ip.as_deref(), Some("203.0.113.7"));
        let meta = RequestMeta::from_parts(&headers, peer, false);
        assert_eq!(meta.ip.as_deref(), Some("127.0.0.1"));
        assert_eq!(meta.locale.as_deref(), Some("en-GB"));
    }
}
