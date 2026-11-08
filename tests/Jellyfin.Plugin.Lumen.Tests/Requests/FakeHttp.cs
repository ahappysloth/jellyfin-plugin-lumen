using System.Net;
using System.Text;
using NSubstitute;

namespace Jellyfin.Plugin.Lumen.Tests.Requests;

/// <summary>An <see cref="IHttpClientFactory"/> whose clients answer from <see cref="Respond"/> and record requests.</summary>
public sealed class FakeHttp : HttpMessageHandler
{
    public List<HttpRequestMessage> Requests { get; } = [];

    public Func<HttpRequestMessage, HttpResponseMessage> Respond { get; set; } = _ => new HttpResponseMessage(HttpStatusCode.NotFound);

    public IHttpClientFactory Factory
    {
        get
        {
            var factory = Substitute.For<IHttpClientFactory>();
            factory.CreateClient(Arg.Any<string>()).Returns(_ => new HttpClient(this, disposeHandler: false));
            return factory;
        }
    }

    public static HttpResponseMessage Json(string json, HttpStatusCode status = HttpStatusCode.OK) =>
        new(status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        Requests.Add(request);
        return Task.FromResult(Respond(request));
    }
}
