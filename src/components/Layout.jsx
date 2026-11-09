import { Outlet } from 'react-router-dom';
import { useState } from 'react';
import { ThemeProvider, Container, CssBaseline, Box, Typography, Link, Button, Paper, Stack } from '@mui/material';
import GitHubIcon from '@mui/icons-material/GitHub';
import KeyIcon from '@mui/icons-material/Key';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useSelector } from 'react-redux';
import { SnackbarProvider } from 'notistack';
import { getTheme } from '../features/theme/themeSlice';
import { lightTheme, darkTheme } from '../theme';
import Header from './Header';

const Layout = () => {
  const theme = useSelector(getTheme);
  const [oneTimeKey, setOneTimeKey] = useState(null);
  const [keyVisible, setKeyVisible] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);
  const [baseUrlCopied, setBaseUrlCopied] = useState(false);
  const instinctBaseUrl = 'https://mf.vishalojha.me/api/instinct';
  const [keyLoading, setKeyLoading] = useState(false);
  const [keyError, setKeyError] = useState('');

  const getOneTimeKey = async () => {
    setKeyLoading(true);
    setKeyError('');
    try {
      const response = await fetch('/api/instinct/keys', { method: 'POST' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not issue a key.');
      setOneTimeKey(body);
      setKeyVisible(false);
      setKeyCopied(false);
    } catch (error) {
      setKeyError(error.message);
    } finally {
      setKeyLoading(false);
    }
  };

  const copyKey = async () => {
    if (oneTimeKey?.key) {
      await navigator.clipboard.writeText(oneTimeKey.key);
      setKeyCopied(true);
    }
  };

  const copyBaseUrl = async () => {
    await navigator.clipboard.writeText(instinctBaseUrl);
    setBaseUrlCopied(true);
  };

  return (
    <ThemeProvider theme={theme === "light" ? lightTheme : darkTheme}>
      <SnackbarProvider maxSnack={3} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} autoHideDuration={5000} preventDuplicate />
      <Container disableGutters maxWidth={"lg"} sx={{ border: 0, borderColor: "#c7c5c5", px: 0 }}>
        <CssBaseline />
        <Header />
        <Box sx={{ mt: "70px" }}>
          <Outlet />
          <Box sx={{ width: "100%", px: "15px", mt: "20px", alignItems: "center" }}>
            <Link href="https://github.com/vishalgojha/mf" target="_blank" rel="noopener" sx={{ display: "flex", alignItems: "center", my: "10px", width: "fit-content" }}>
              <Typography variant='h4' sx={{ fontFamily: "Exo" }}>LevelLens</Typography>
              <GitHubIcon sx={{ ml: "10px", fontSize: "30px", verticalAlign: "middle" }} />
            </Link>
            <Typography variant='body2' sx={{ color: "text.secondary", textAlign: "justify", pb: "20px" }}>
              A free, open-source way to look at Indian mutual funds. Search any scheme and
              chart its historical NAV, or open Nifty range performance: pick two Nifty 50
              levels, and the app finds the most recent time the index travelled between
              them, then ranks the covered Direct-Growth funds over exactly those dates.
              Compare each fund with the index, see which categories led, and download the
              NAV data as CSV. Fund NAVs come from the
                <Link href="https://www.mfapi.in/" target="_blank" rel="noopener"> MFAPI.in</Link> free API;
              Nifty 50 closes are bundled from NSE data. Built with React, D3, and Material UI.
            </Typography>
            <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, mb: 3, borderTop: 4, borderTopColor: '#ff834f' }}>
              <Stack spacing={1}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <AutoAwesomeIcon sx={{ color: '#ff834f' }} />
                  <Typography variant="h5" fontWeight="bold">Instinct AI</Typography>
                </Box>
                <Typography variant="body1" color="text.secondary">
                  Give Instinct direct access to LevelLens market data. It can search the covered funds, resolve Nifty level windows, compare returns, and retrieve NAV data for all available funds.
                </Typography>
                <Box sx={{ p: 1.5, borderRadius: 1, bgcolor: 'action.hover' }}>
                  <Typography variant="subtitle2" fontWeight="bold">API base URL</Typography>
                  <Typography component="code" variant="body2" sx={{ wordBreak: 'break-all' }}>{instinctBaseUrl}</Typography>
                  <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
                    <Button size="small" startIcon={<ContentCopyIcon />} onClick={copyBaseUrl}>
                      {baseUrlCopied ? 'Copied' : 'Copy URL'}
                    </Button>
                    <Button size="small" component="a" href={`${instinctBaseUrl}/openapi.json`} target="_blank" rel="noopener" endIcon={<OpenInNewIcon />}>
                      Open API schema
                    </Button>
                  </Box>
                </Box>
                <Typography variant="body2" color="text.secondary">
                  Direct fund and Nifty tools are public and read-only, so most Instinct integrations do not need a bearer key. Use the one-time key below only for the hosted natural-language <code>/ask</code> endpoint.
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Need hosted answers? Get a free bearer key for one request. It expires after 10 minutes and is never stored in your browser. Copy it directly into Instinct Vault.
                </Typography>
                <Box>
                  <Button
                    variant="contained"
                    size="small"
                    startIcon={<KeyIcon />}
                    onClick={getOneTimeKey}
                    disabled={keyLoading}
                  >
                    {keyLoading ? 'Creating key…' : 'Create one-time key'}
                  </Button>
                </Box>
                {oneTimeKey && (
                  <Stack spacing={1}>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Typography component="code" sx={{ letterSpacing: 1 }}>
                        {keyVisible ? oneTimeKey.key : '••••••••••••••••••••••••••••••••'}
                      </Typography>
                      <Button size="small" onClick={() => setKeyVisible((visible) => !visible)}>
                        {keyVisible ? 'Hide' : 'Reveal'}
                      </Button>
                      <Button size="small" startIcon={<ContentCopyIcon />} onClick={copyKey}>
                        {keyCopied ? 'Copied' : 'Copy key'}
                      </Button>
                    </Box>
                    <Typography variant="body2" color="text.secondary">
                      In Instinct Vault, click <strong>+</strong> → <strong>Add login</strong> and use:
                    </Typography>
                    <Box component="ul" sx={{ m: 0, pl: 3, color: 'text.secondary' }}>
                      <li><Typography variant="body2">Name: <em>anything you choose</em></Typography></li>
                      <li><Typography variant="body2">Password: <em>paste the copied API key</em></Typography></li>
                      <li><Typography variant="body2">Website: <code>mf.vishalojha.me</code></Typography></li>
                    </Box>
                    <Typography variant="caption" color="text.secondary">
                      Use the key as <code>Authorization: Bearer &lt;key&gt;</code> for <code>/api/instinct/ask</code>. The masked key is not shown again unless you choose Reveal.
                    </Typography>
                  </Stack>
                )}
                {keyError && <Typography variant="body2" color="error">{keyError}</Typography>}
              </Stack>
            </Paper>
          </Box>
        </Box>
      </Container>
    </ThemeProvider>
  );
};

export default Layout;
