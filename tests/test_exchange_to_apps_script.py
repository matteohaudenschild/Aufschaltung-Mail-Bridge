import io
import os
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import Mock, call, patch


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY_ROOT / "exchange_mail_bridge"))

import exchange_to_apps_script as bridge  # noqa: E402


DEFAULT_FINAL_URL = "https://script.googleusercontent.com/macros/echo?user_content_key=url-secret"
JSON_NOT_SET = object()


def response(
    status=200,
    *,
    url=DEFAULT_FINAL_URL,
    content=b'{"ok": true}',
    json_data=JSON_NOT_SET,
    json_error=None,
):
    result = Mock()
    result.status_code = status
    result.url = url
    result.content = content
    if json_error is not None:
        result.json.side_effect = json_error
    else:
        result.json.return_value = (
            {"ok": True} if json_data is JSON_NOT_SET else json_data
        )
    return result


class AppsScriptPostRetryTests(unittest.TestCase):
    def setUp(self):
        self.environment = {
            "APPS_SCRIPT_WEBAPP_URL": (
                "https://script.google.com/macros/s/deployment-secret/exec?access=url-secret"
            ),
            "BRIDGE_TOKEN": "bridge-token-secret",
            "APPS_SCRIPT_RETRY_BASE_DELAY_SECONDS": "0",
            "APPS_SCRIPT_RETRY_JITTER_SECONDS": "0",
        }
        self.environment_patch = patch.dict(os.environ, self.environment, clear=True)
        self.environment_patch.start()
        self.addCleanup(self.environment_patch.stop)
        self.message = {
            "id": "message-1",
            "subject": "confidential-subject",
            "bodyHtml": "confidential-mail-body",
        }

    def test_timeout_and_connection_error_retry_then_succeed(self):
        os.environ["APPS_SCRIPT_RETRY_BASE_DELAY_SECONDS"] = "2"
        request = Mock(
            side_effect=[
                bridge.requests.Timeout("timeout at ?access=url-secret"),
                bridge.requests.ConnectionError("bridge-token-secret connection failed"),
                response(json_data={"ok": True, "appended": 1}),
            ]
        )

        with patch.object(bridge.requests, "post", request), patch.object(
            bridge.time, "sleep"
        ) as sleep, redirect_stdout(io.StringIO()) as output:
            result = bridge.post_messages([self.message])

        self.assertEqual(result["appended"], 1)
        self.assertEqual(request.call_count, 3)
        self.assertEqual(sleep.call_args_list, [call(2.0), call(4.0)])
        for request_call in request.call_args_list:
            self.assertEqual(request_call.kwargs["timeout"], (10.0, 60.0))
        self.assertNotIn("url-secret", output.getvalue())
        self.assertNotIn("bridge-token-secret", output.getvalue())
        self.assertNotIn("confidential-mail-body", output.getvalue())

    def test_attempt_count_is_configurable_and_exhaustion_error_is_safe(self):
        os.environ["APPS_SCRIPT_POST_ATTEMPTS"] = "2"
        unsafe_exception = bridge.requests.Timeout(
            "POST https://script.google.com/exec?token=url-secret timed out; "
            "body=confidential-mail-body"
        )

        with patch.object(
            bridge.requests,
            "post",
            side_effect=[unsafe_exception, unsafe_exception],
        ) as request, redirect_stdout(io.StringIO()) as output:
            with self.assertRaises(RuntimeError) as raised:
                bridge.post_messages([self.message])

        self.assertEqual(request.call_count, 2)
        combined_output = output.getvalue() + str(raised.exception)
        self.assertNotIn("url-secret", combined_output)
        self.assertNotIn("bridge-token-secret", combined_output)
        self.assertNotIn("confidential-mail-body", combined_output)
        self.assertIn("after 2 attempt(s): timeout", str(raised.exception))

    def test_interrupted_chunked_response_retries_then_succeeds(self):
        interrupted = bridge.requests.exceptions.ChunkedEncodingError(
            "incomplete response from ?access=url-secret; confidential-mail-body"
        )

        with patch.object(
            bridge.requests,
            "post",
            side_effect=[interrupted, response(json_data={"ok": True, "appended": 1})],
        ) as request, redirect_stdout(io.StringIO()) as output:
            result = bridge.post_messages([self.message])

        self.assertEqual(result["appended"], 1)
        self.assertEqual(request.call_count, 2)
        self.assertIn('"reason": "response_interrupted"', output.getvalue())
        self.assertNotIn("url-secret", output.getvalue())
        self.assertNotIn("confidential-mail-body", output.getvalue())

    def test_separate_connect_and_read_timeouts_are_configurable(self):
        os.environ["APPS_SCRIPT_CONNECT_TIMEOUT_SECONDS"] = "3.5"
        os.environ["APPS_SCRIPT_READ_TIMEOUT_SECONDS"] = "71.25"

        with patch.object(
            bridge.requests, "post", return_value=response()
        ) as request:
            bridge.post_messages([self.message])

        self.assertEqual(request.call_args.kwargs["timeout"], (3.5, 71.25))

    def test_legacy_timeout_remains_the_default_read_timeout(self):
        os.environ["APPS_SCRIPT_TIMEOUT"] = "47"

        with patch.object(
            bridge.requests, "post", return_value=response()
        ) as request:
            bridge.post_messages([self.message])

        self.assertEqual(request.call_args.kwargs["timeout"], (10.0, 47.0))

    def test_exponential_backoff_adds_bounded_jitter(self):
        os.environ["APPS_SCRIPT_RETRY_BASE_DELAY_SECONDS"] = "2"
        os.environ["APPS_SCRIPT_RETRY_JITTER_SECONDS"] = "0.5"
        transient = response(status=503)

        with patch.object(
            bridge.requests,
            "post",
            side_effect=[transient, transient, response()],
        ), patch.object(
            bridge.random, "uniform", side_effect=[0.1, 0.4]
        ) as uniform, patch.object(bridge.time, "sleep") as sleep, redirect_stdout(
            io.StringIO()
        ):
            bridge.post_messages([self.message])

        self.assertEqual(uniform.call_args_list, [call(0.0, 0.5), call(0.0, 0.5)])
        self.assertEqual(sleep.call_args_list, [call(2.1), call(4.4)])

    def test_expected_transient_http_statuses_retry(self):
        for status in (408, 425, 429, 500, 503, 599):
            with self.subTest(status=status), patch.object(
                bridge.requests,
                "post",
                side_effect=[response(status=status), response()],
            ) as request, redirect_stdout(io.StringIO()):
                bridge.post_messages([self.message])

            self.assertEqual(request.call_count, 2)

    def test_googleusercontent_404_retries(self):
        first = response(
            status=404,
            url=(
                "https://script.googleusercontent.com/macros/echo"
                "?user_content_key=url-secret"
            ),
        )

        with patch.object(
            bridge.requests, "post", side_effect=[first, response()]
        ) as request, redirect_stdout(io.StringIO()) as output:
            bridge.post_messages([self.message])

        self.assertEqual(request.call_count, 2)
        self.assertIn('"finalHost": "script.googleusercontent.com"', output.getvalue())
        self.assertNotIn("url-secret", output.getvalue())

    def test_retry_log_redacts_an_unexpected_final_host(self):
        unsafe_host_response = response(
            status=503,
            url="https://bridge-token-secret.example.org/?mail=confidential-mail-body",
        )

        with patch.object(
            bridge.requests,
            "post",
            side_effect=[unsafe_host_response, response()],
        ), redirect_stdout(io.StringIO()) as output:
            bridge.post_messages([self.message])

        self.assertIn('"finalHost": "other"', output.getvalue())
        self.assertNotIn("bridge-token-secret", output.getvalue())
        self.assertNotIn("confidential-mail-body", output.getvalue())

    def test_404_on_any_other_final_host_does_not_retry(self):
        for host in (
            "script.google.com",
            "evil-script.googleusercontent.com",
            "script.googleusercontent.com.example.org",
        ):
            with self.subTest(host=host), patch.object(
                bridge.requests,
                "post",
                return_value=response(status=404, url=f"https://{host}/?secret=url-secret"),
            ) as request:
                with self.assertRaisesRegex(RuntimeError, "non-retryable HTTP 404"):
                    bridge.post_messages([self.message])

            self.assertEqual(request.call_count, 1)

    def test_hard_http_client_errors_do_not_retry(self):
        for status in (400, 401, 403, 409, 422):
            with self.subTest(status=status), patch.object(
                bridge.requests,
                "post",
                return_value=response(status=status),
            ) as request:
                with self.assertRaisesRegex(
                    RuntimeError, f"non-retryable HTTP {status}"
                ):
                    bridge.post_messages([self.message])

            self.assertEqual(request.call_count, 1)

    def test_empty_success_response_retries(self):
        empty = response(status=200, content=b"")

        with patch.object(
            bridge.requests, "post", side_effect=[empty, response()]
        ) as request, redirect_stdout(io.StringIO()):
            bridge.post_messages([self.message])

        self.assertEqual(request.call_count, 2)
        empty.json.assert_not_called()

    def test_whitespace_success_response_retries(self):
        whitespace = response(status=200, content=b" \r\n\t")

        with patch.object(
            bridge.requests, "post", side_effect=[whitespace, response()]
        ) as request, redirect_stdout(io.StringIO()):
            bridge.post_messages([self.message])

        self.assertEqual(request.call_count, 2)

    def test_non_json_success_response_retries(self):
        html = response(
            status=200,
            content=b"<html>temporary error</html>",
            json_error=ValueError("confidential-mail-body"),
        )

        with patch.object(
            bridge.requests, "post", side_effect=[html, response()]
        ) as request, redirect_stdout(io.StringIO()) as output:
            bridge.post_messages([self.message])

        self.assertEqual(request.call_count, 2)
        self.assertNotIn("confidential-mail-body", output.getvalue())

    def test_non_object_json_success_response_retries(self):
        invalid = response(json_data=[{"ok": True}])

        with patch.object(
            bridge.requests, "post", side_effect=[invalid, response()]
        ) as request, redirect_stdout(io.StringIO()):
            bridge.post_messages([self.message])

        self.assertEqual(request.call_count, 2)

    def test_valid_ok_false_does_not_retry_or_echo_response(self):
        rejected = response(
            json_data={
                "ok": False,
                "error": "bridge-token-secret confidential-mail-body",
            }
        )

        with patch.object(
            bridge.requests, "post", return_value=rejected
        ) as request:
            with self.assertRaises(SystemExit) as raised:
                bridge.post_messages([self.message])

        self.assertEqual(request.call_count, 1)
        self.assertEqual(
            str(raised.exception),
            "Apps Script returned an error response (ok=false).",
        )

    def test_transient_marker_must_be_json_boolean_true(self):
        rejected = response(
            json_data={
                "ok": False,
                "transient": "true",
                "error": "script_busy",
            }
        )

        with patch.object(
            bridge.requests, "post", return_value=rejected
        ) as request:
            with self.assertRaisesRegex(SystemExit, "ok=false"):
                bridge.post_messages([self.message])

        self.assertEqual(request.call_count, 1)

    def test_explicit_transient_json_response_retries_and_honors_retry_after(self):
        os.environ["APPS_SCRIPT_RETRY_BASE_DELAY_SECONDS"] = "2"
        busy = response(
            json_data={
                "ok": False,
                "transient": True,
                "error": "script_busy",
                "retryAfterSeconds": 7,
                "statusCode": 503,
            }
        )

        with patch.object(
            bridge.requests, "post", side_effect=[busy, response()]
        ) as request, patch.object(bridge.time, "sleep") as sleep, redirect_stdout(
            io.StringIO()
        ) as output:
            bridge.post_messages([self.message])

        self.assertEqual(request.call_count, 2)
        sleep.assert_called_once_with(7.0)
        self.assertIn('"reason": "apps_script_transient_response"', output.getvalue())
        self.assertIn('"status": 503', output.getvalue())

    def test_transient_json_response_is_bounded_by_maximum_attempts(self):
        os.environ["APPS_SCRIPT_POST_ATTEMPTS"] = "2"
        busy = response(
            json_data={
                "ok": False,
                "transient": True,
                "retryAfterSeconds": 0,
            }
        )

        with patch.object(
            bridge.requests, "post", side_effect=[busy, busy]
        ) as request, redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(SystemExit, "ok=false"):
                bridge.post_messages([self.message])

        self.assertEqual(request.call_count, 2)

    def test_unexpected_requests_exception_is_sanitized_without_retry(self):
        unsafe_exception = bridge.requests.RequestException(
            "https://script.google.com/?token=url-secret confidential-mail-body"
        )

        with patch.object(
            bridge.requests, "post", side_effect=unsafe_exception
        ) as request:
            with self.assertRaises(RuntimeError) as raised:
                bridge.post_messages([self.message])

        self.assertEqual(request.call_count, 1)
        self.assertNotIn("url-secret", str(raised.exception))
        self.assertNotIn("confidential-mail-body", str(raised.exception))

    def test_batches_still_aggregate_counts_and_auto_reply_details(self):
        os.environ["POST_BATCH_SIZE"] = "1"
        first = response(
            json_data={
                "ok": True,
                "appended": 1,
                "skipped": 2,
                "autoReply": {
                    "triggered": True,
                    "checked": 3,
                    "sent": 1,
                    "details": [{"id": "first"}],
                },
            }
        )
        second = response(
            json_data={
                "ok": True,
                "updated": 2,
                "skipped": 1,
                "autoReply": {
                    "triggered": False,
                    "checked": 2,
                    "review": 1,
                    "error": "safe-test-error",
                    "details": [{"id": "second"}],
                },
            }
        )

        with patch.object(
            bridge.requests, "post", side_effect=[first, second]
        ) as request:
            result = bridge.post_messages([self.message, {"id": "message-2"}])

        self.assertEqual(request.call_count, 2)
        self.assertEqual(result["appended"], 1)
        self.assertEqual(result["updated"], 2)
        self.assertEqual(result["skipped"], 3)
        self.assertEqual(result["autoReply"]["triggered"], True)
        self.assertEqual(result["autoReply"]["checked"], 5)
        self.assertEqual(result["autoReply"]["sent"], 1)
        self.assertEqual(result["autoReply"]["review"], 1)
        self.assertEqual(result["autoReply"]["errors"], ["safe-test-error"])
        self.assertEqual(
            result["autoReply"]["details"],
            [{"id": "first"}, {"id": "second"}],
        )


if __name__ == "__main__":
    unittest.main()
